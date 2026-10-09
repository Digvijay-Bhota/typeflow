# TypeFlow Architecture

## Database Access Model (Phase 5C-1)

Application data is server-only. The browser never reads or writes application tables.

- **Application tables** (`public` schema) are accessed only by the server through Prisma, connecting as `postgres`, the tables' owner.
- **Supabase** provides Auth (`/auth/v1`, `auth` schema) and Storage (`/storage/v1`, certificate PDFs uploaded with the service-role key). Its Data API (PostgREST) is not used for application data.
- **Data API roles** (`anon`, `authenticated`) have no access to `public` tables. Migration `20260926000000_lock_down_public_schema_data_api` enabled RLS with no policies on every table, and revoked their privileges on tables, sequences, functions and future objects (default privileges). Both layers hold independently: RLS hides rows if a grant reappears, and missing grants deny access (including `TRUNCATE`, which RLS does not cover) if RLS is disabled.
- **Unchanged:** `service_role`, schema `USAGE`, and the `auth`/`storage` schemas. No `FORCE ROW LEVEL SECURITY` (the owner and `BYPASSRLS` roles are exempt).

**Rule for new tables:** every migration that adds a table to `public` must enable RLS on it and add no `anon`/`authenticated` policies. `tests/integration/db-privileges-pg.test.ts` enforces this against a test database that reproduces Supabase's roles and grants (`tests/setup/supabase-roles.sql`).

## Environment Isolation (Phase 5C-2)

Production data and infrastructure are never used by Preview or development.

|                             | Production        | Preview / staging                           | Local development       |
| --------------------------- | ----------------- | ------------------------------------------- | ----------------------- |
| Database + Supabase project | production        | separate project                            | local Postgres          |
| Redis                       | production        | separate instance (keys are also scoped)    | local                   |
| Razorpay                    | live keys         | Test Mode (`rzp_test_`), own webhook secret | Test Mode               |
| `APP_URL`                   | production domain | preview/staging URL                         | `http://localhost:3000` |

**Guard.** `src/lib/environmentGuard.ts` refuses a non-production runtime — `VERCEL_ENV` other than `production` (previews, custom environments, `vercel dev`), or `next dev` — before it can use production infrastructure. It runs in `getServerEnv()` (Redis, Razorpay, Storage, auth rate limits) and when `src/server/db.ts` loads (Prisma). It rejects:

- `DATABASE_URL` / `DIRECT_URL` that point at the production Supabase project. The production project is named by `PRODUCTION_SUPABASE_PROJECT_REF` (a public project ref, not a secret); while it is unset, every non-local database is rejected, because nothing proves it is not production.
- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` that point at the production project (deployed previews also fail closed while the ref is unset).
- Razorpay key IDs that are not Test Mode (`rzp_test_`).
- `APP_URL` / `NEXT_PUBLIC_APP_URL` equal to the production domain Vercel reports (`VERCEL_PROJECT_PRODUCTION_URL`); branch/deployment preview URLs pass.

Errors name the variables only, never their values, and start with `Configuration Error` so they surface as failures rather than silent rate-limit rejections. Production and test configurations are not checked.

**Redis.** Rate-limit keys are `rl:v1:<environment>:<hash>` (`production`, `preview`, `development`), so environments sharing a Redis instance never share counters. Tests keep `TEST_RL_PREFIX`.

**Migrations.** Never `prisma migrate dev`, against any database. New migrations are written with `npm run db:migrate:new`, which only uses a throwaway local database (see Migration Workflow). Staging and production are migrated with `prisma migrate deploy` only, run manually from `main`; builds never migrate.

**Manual configuration still required (Vercel, external).** Until done, the guard makes misconfigured previews fail by design:

1. Split every variable currently shared by Production and Preview into Production-only and Preview-only records, with Preview pointing at staging: database URLs, Supabase keys, `REDIS_URL`, Razorpay keys/webhook secret/plan IDs, `SESSION_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`.
2. Set `PRODUCTION_SUPABASE_PROJECT_REF` for Preview and Development.
3. Remove the stale `phase-5b-razorpay-validation` branch overrides (`APP_URL`, `NEXT_PUBLIC_APP_URL`, `RAZORPAY_WEBHOOK_SECRET`).

## Certificate PDF: Recipient Names (Phase 5C-3)

`renderCertificatePdf` draws the "Recipient:" line with `src/lib/certificateRecipient.ts` (pure, deterministic):

- **Latin names** Helvetica (WinAnsi) can draw render exactly as before: one `drawText`, 18 pt, no extra font embedded.
- **Devanagari** (Hindi, Marathi, …) is drawn with Noto Sans Devanagari Regular (OFL 1.1), bundled at `src/server/assets/fonts/` and subsetted into the PDF through `@pdf-lib/fontkit`. It is read from disk (never fetched) and traced into every function that renders certificates (`/api/payment/webhook`, `/api/certificate/fulfill`, `/api/cron/reconcile-payments`) by `outputFileTracingIncludes` in `next.config.ts`. `regenerator-runtime` is only there because fontkit's shaper expects it as a global.
- **Emoji**, control, bidi and invisible format characters are removed; text is NFC-normalized and whitespace collapsed.
- **Any other script** (e.g. CJK, Greek, Cyrillic, Latin letters outside WinAnsi such as `Ł`) replaces the whole name with `(see verification page)`, never a partial name. The verification page (HTML) shows the stored name, and the QR code links to it.
- **Long names** shrink from 18 pt to 11 pt, then are cut at a grapheme boundary with `…`, so they never overlap the WPM column or fail.
- **Failures:** if drawing the Devanagari text fails, the certificate is rendered with the fallback text (logged), so a name never blocks fulfillment. A missing font file (a deployment fault) fails the render instead, which leaves the certificate `PENDING_FULFILLMENT` and retryable, as any other fulfillment failure does.

Text extracted from the PDF (copy/paste, search) shows Devanagari in visual glyph order; the drawn text is correct. The recipient name is still read live from `User.displayName` when the PDF is rendered and on the verification page. Snapshotting it on the certificate at issuance needs a schema migration and deploy ordering, so it is left as separate work.

## Certificate Integrity (Phase 6)

- **Verification URL.** The PDF and its QR code embed `<APP_URL>/verify/<certificateId>` for good, and `qrData` stores it. In a production deployment, `fulfillCertificate` refuses to embed any host other than the production domain (`VERCEL_PROJECT_PRODUCTION_URL`: `productionAppUrlMismatch` in `environmentGuard.ts`). A mismatch, including an unset `APP_URL`, is a fulfilment failure: the certificate stays `PENDING_FULFILLMENT` and is retried (webhook redelivery, reconciliation, owner retry) once `APP_URL` is fixed and redeployed. Preview, development and test are not checked. **Production `APP_URL` must equal the production domain**; if a custom domain is added, update `APP_URL` in the same change. `TF-2026-C9XGPR` was fulfilled with a Preview branch URL before this guard; its repair is a separate, approval-gated operation.
- **`TF-2026-C9XGPR` QR repair (F1) — completed and removed.** A one-off route (PR #21, removed afterwards) re-rendered that one certificate's PDF with `https://typeflow-dusky.vercel.app/verify/TF-2026-C9XGPR` at the same storage path and moved `qrData` from the Preview URL to it, under a row lock, with a compare-and-set and one audit row in the same transaction.
  - **Run:** 2026-09-28 18:50:30 UTC, run id `dabf176c-1407-489a-947a-63af63c9b498`, after a dry run. PDF 3,877 → 3,794 bytes (SHA-256 `c2adcc8f…` → `7e85cb89…`); status, signature, identity, score fields, `pdfUrl`, the payment and every other certificate unchanged; the public PDF shows the production URL and not the old host; `/verify/TF-2026-C9XGPR` is "authentic and currently valid". A second run was a no-op. No active certificate has a Preview QR URL.
  - **Record:** one `audit_logs` row (`action=CERTIFICATE_QR_REPAIRED`, `resourceId=TF-2026-C9XGPR`, metadata `runId`, `oldQrData`, `newQrData`, `oldPdfSha256`, `newPdfSha256`, `oldPdfBase64` — the original PDF, kept there instead of in the public bucket). **Keep this row.**
  - **Rollback, if ever needed** (only if the new PDF itself turns out to be defective; it restores the broken Preview-URL QR code): upload the bytes of `metadata.oldPdfBase64` (after checking they hash to `metadata.oldPdfSha256`) to `certificates/TF-2026-C9XGPR.pdf`, then `UPDATE certificates SET "qrData" = <metadata.oldQrData> WHERE "certificateId" = 'TF-2026-C9XGPR' AND "qrData" = <metadata.newQrData>` (compare-and-set: it changes nothing unless the repair's value is still there).
- **Certificate IDs** (`TF-YYYY-XXXXXX`) come from `crypto.randomInt`, so they cannot be predicted.
- **One accuracy figure.** The PDF, the verification page and the owner's dashboard all show `certificateAccuracyPercent` (one decimal, e.g. `97.6%`).
- **Recipient name.** The PDF and the verification page read `User.displayName` live. That is safe only while a display name cannot change after sign-up (today it is set once, from the auth provider, and shown read-only in settings). **Before any feature lets a user change their name (e.g. profile editing), the recipient name must be snapshotted on the certificate at fulfilment** (a schema change and a backfill of existing certificates); otherwise an issued certificate's verification page would show the new name next to results earned under the old one.
- **Known, reviewed in Phase 7:** the `certificates` storage bucket is public, so a certificate's PDF stays downloadable by its URL after revocation (its QR code leads to the verification page, which shows it as revoked); a single signing secret with no key version (see Legacy Certificate Re-sign: rotating it would invalidate every certificate).

## Legacy Certificate Re-sign (Phase 5C-9) — completed and removed

Until **2026-09-26T00:21:25Z** (deployment `e0a6383`), Production signed `verificationHash` with `SESSION_SECRET`; verification has used `CERTIFICATE_SIGNING_SECRET` since, and the old `SESSION_SECRET` value was later replaced. The six certificates issued before that cutover (`TF-2026-C9XGPR`, `TF-2026-64BP7J`, `TF-2026-LR88NY`, `TF-2026-AREJKD`, `TF-2026-TVY3N3`, `TF-2026-PT8BB9`) could never verify.

A one-off maintenance endpoint (PR #15, removed afterwards) recomputed their hashes with `generateVerificationHash` from each row's own `certificateId`, `userId` and `issuedAt`. It changed `verificationHash` only: the hash is not part of the PDF or the QR code (which encode the verify URL), so every certificate kept its number, owner, result, issue date, status, PDF, QR code and public URL.

- **Run:** 2026-09-28 04:21:48 UTC, run id `8850c272-dd7e-4520-8847-1ec40f90ca5b`: `resigned: 6`, all safety checks true (no other certificate, no other certificate field and no payment changed). `/verify/TF-2026-C9XGPR` went from "could not be verified" to "authentic and currently valid"; the five others remain `PENDING_PAYMENT`, now verifiable if activated.
- **Record:** one `audit_logs` row per certificate (`action=CERTIFICATE_RESIGNED`, `resource=Certificate`, `resourceId=<certificate id>`, metadata `runId`, `oldHash`, `resignedHash`, `cutover`, `reason`). **Keep these rows.**
- **Rollback, if ever needed:** the endpoint no longer exists. For a certificate whose `verificationHash` still equals its audit row's `resignedHash`, set it back to that row's `oldHash` (compare-and-set on `resignedHash`, `verificationHash` only). The old hashes cannot be verified by any current secret, so this restores the "could not be verified" state.
- Certificates issued since the cutover are unaffected; no certificate can be signed with `SESSION_SECRET` any more (`CERTIFICATE_SIGNING_SECRET` must differ from it).

## Phase 8: Subscription Architecture

The Pro Subscription system isolates recurring billing from one-time certificate payments to maintain clean service boundaries.

### Provider Data Model

We use Razorpay as the subscription provider. The `Subscription` model tracks the state of user entitlements:

- `id`: Internal UUID
- `userId`: Relation to `User` (Unique)
- `provider`: Provider enum (e.g., `RAZORPAY`)
- `providerSubscriptionId`: Provider-specific ID (e.g., `sub_XXXXXX`)
- `providerPlanId`: Configured via environment variables
- `plan`: Enum (`FREE`, `PRO`)
- `status`: Lifecycle state (`ACTIVE`, `TRIALING`, `PAST_DUE`, `CANCELLED`, `EXPIRED`)
- `currentPeriodStart` / `currentPeriodEnd`: Current billing cycle boundaries
- `cancelAt` / `cancelledAt`: Tracks cancellation intent and timestamp

Webhook idempotency is handled by a separate `SubscriptionEvent` table, distinguishing recurring billing events from one-time payment events.

### State Machine

Transitions match the provider's lifecycle and are maintained locally via webhooks:

- **TRIALING → ACTIVE**: Initial payment succeeds.
- **TRIALING → CANCELLED**: User cancels before the first payment.
- **ACTIVE → PAST_DUE**: Recurring payment fails (grace period starts).
- **ACTIVE → CANCELLED**: User cancels subscription (access retained until period end).
- **PAST_DUE → ACTIVE**: Payment retried successfully.
- **PAST_DUE → CANCELLED**: User cancels during the grace period.
- **PAST_DUE → EXPIRED**: Max payment retries exceeded (halted).
- **CANCELLED → EXPIRED**: `currentPeriodEnd` passes, and the subscription officially ends.

### Entitlement Logic

Pro entitlement is evaluated purely server-side (`requirePro(userId)` guard) and never cached globally. A user is entitled if:

1. They are authenticated.
2. `subscription.plan === "PRO"`.
3. `subscription.status` is `ACTIVE`, `TRIALING`, or `PAST_DUE` (grace period).
4. `subscription.status` is `CANCELLED`, but `currentPeriodEnd > now()` (at-period-end cancellation).

Expired subscriptions (`EXPIRED`) immediately lose access.

### Pricing Configuration

Pricing is strictly server-authoritative to prevent manipulation:

- Server configuration (`src/lib/constants.ts`) defines price amounts (e.g., `PRO_MONTHLY_PRICE_PAISE`).
- Environment variables map billing intervals to specific provider plan IDs (e.g., `RAZORPAY_PLAN_ID_PRO_MONTHLY`).
- The client only specifies the `interval` (`monthly` or `yearly`).
- The billing cycle count (`total_count`) is server-side too: `PRO_MONTHLY_TOTAL_COUNT` (468) and `PRO_YEARLY_TOTAL_COUNT` (39), a 39-year horizon. Razorpay has no "until cancelled" option and rejects `total_count: 0`, and its hosted checkout refuses subscriptions expiring 40 or more years out ("expire_at cannot be more than 40 years"). The horizon is not a contract length; customers cancel at any time.

### Cancellation Behavior

TypeFlow uses "at-period-end" cancellation:

- Invoking cancellation immediately sets the provider's subscription to cancel at cycle end.
- Locally, `status` becomes `CANCELLED` and `cancelAt` is populated.
- Entitlement checks permit access as long as the current date is before `currentPeriodEnd`.

### Payment-Failure Behavior

If a recurring payment fails:

- Razorpay transitions the subscription to `halted` (mapped to `PAST_DUE` locally).
- The user is in a "grace period" and retains access until `currentPeriodEnd`.
- If Razorpay exhausts its automated retries without success, the subscription expires, transitioning to `EXPIRED`.

### Webhook Strategy

- Separate from the certificate webhook (`/api/subscription/webhook`).
- Signature verification requires reading the raw body string + HMAC-SHA256.
- Idempotent processing ensures duplicate events are skipped by tracking `providerEventId` in `SubscriptionEvent`.

## Payment Webhook Hardening (Phase 5C-7)

`POST /api/payment/webhook` checks the signature on the raw body **before** parsing it: HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`, accepted only as the exact 64-character lowercase hex digest and compared in constant time (`timingSafeEqual`). The service checks it again before any database access. `verifyRazorpaySubscriptionSignature` uses the same comparison.

| Delivery                                                               | Response                                                                                   | Recorded                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing, malformed or wrong signature                                  | 401 (Razorpay retries, so genuine deliveries recover once a misconfigured secret is fixed) | Log only (`reason`, well-formed event id, body length). Never the body, signature or secret; never the database, since the request is unauthenticated                               |
| Signed body that is not JSON                                           | 400                                                                                        | Log only                                                                                                                                                                            |
| Processed, duplicate, or unhandled event type                          | 200                                                                                        | The PaymentEvent (duplicates: nothing new)                                                                                                                                          |
| Order not ours (e.g. another environment on the same Razorpay account) | 200                                                                                        | Info log                                                                                                                                                                            |
| Captured amount/currency ≠ the order's                                 | 200: signed and identical on every redelivery, so retrying cannot fix it                   | One `webhook.anomaly` PaymentEvent per Razorpay payment (`webhook:anomaly:<amount\|currency>_mismatch:<pay id>`, minimal fields only); payment and certificate unchanged; error log |
| Fulfillment failed after the capture was recorded                      | 503 (redelivery retries fulfillment)                                                       | Error log                                                                                                                                                                           |
| Anything else (e.g. database)                                          | 500 (transient, retried)                                                                   | Error log                                                                                                                                                                           |

## Payment Reconciliation (Phase 5C-5)

The signed Razorpay webhook remains the primary path for certificate purchases. `src/server/services/payment.reconciliation.service.ts` is a safety net for when that path did not complete (a missed delivery, or Razorpay giving up on redelivery). **It never creates an order, captures, refunds or charges**: it only reads Razorpay (`fetchRazorpayOrderPayments`, `fetchRazorpayPayment`, `fetchRazorpayPaymentRefunds` in `razorpay.service.ts`).

**Coverage** (stale payments only: last changed ≥ 15 min ago, created ≤ 7 days ago):

| Case                                  | Database                             | Razorpay                                                         | REPORT                                     | APPLY                                                                                        |
| ------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| C1 missed capture                     | PENDING/FAILED                       | exactly one captured payment of this order, same amount/currency | `recon:report:captured:<pay>`              | capture transition (`recon:captured:<pay>`), then fulfilment                                 |
| C1 captured and refunded              | PENDING/FAILED                       | that payment, processed refunds ≥ its amount                     | `recon:report:refunded:<pay>`              | full-refund transition (`recon:refunded:<pay>`): REFUNDED + REVOKED                          |
| C2 stuck fulfilment                   | COMPLETED, cert PENDING_FULFILLMENT  | recorded payment matches, no refund                              | `recon:report:fulfillment:<pay>`           | `fulfillCertificate()` (`recon:fulfilled:<pay>` on success); storage failure → stays pending |
| C3 order / amount / currency mismatch | any                                  | payment of another order, or other amount/currency               | anomaly                                    | anomaly only                                                                                 |
| C3 multiple / missing captures        | any                                  | > 1 captured payment, or none on a paid purchase                 | anomaly (`…:<order>`)                      | anomaly only                                                                                 |
| C4 held for review                    | COMPLETED, cert PENDING_PAYMENT      | —                                                                | anomaly                                    | anomaly only (human decision)                                                                |
| C5 authorized only                    | PENDING/FAILED                       | authorized, none captured                                        | anomaly (`…:<order>`)                      | anomaly only (never captured)                                                                |
| C6 missed full refund                 | COMPLETED, cert ACTIVE / PENDING\_\* | processed refunds ≥ amount                                       | `recon:report:refunded:<pay>`              | full-refund transition                                                                       |
| Refund not settled                    | any                                  | a pending, failed or unclear refund, processed total < amount    | anomaly `refund_pending` / `refund_failed` | anomaly only                                                                                 |

**Refunds are decided from the refund records** (`GET /v1/payments/:id/refunds`), never from the payment-level `status`/`refund_status`/`amount_refunded` fields, which only trigger the lookup. Only refunds with status `processed` in the payment's currency count, matching the webhook, which acts only on `refund.processed`. Processed refunds totalling at least the payment amount → full-refund transition. Otherwise any failed refund → `refund_failed`; any pending refund, a processed refund in another currency, or a payment-level refund signal without refund records → `refund_pending`; these change nothing. Processed refunds below the amount (partial) change nothing, as in the webhook. The recorded payment id must belong to the purchase's order with its exact amount and currency (the webhook's own `orderAmountMismatch` check); without a recorded payment id, exactly one captured payment is required. Nothing paid (abandoned or failed attempts, an auto-refunded authorization) changes nothing.

Anomalies are `recon:anomaly:<kind>:<razorpay payment or order id>`, eventType `reconciliation.anomaly`.

**Modes** (`PAYMENT_RECONCILE_MODE`): `off` (default; also any unknown value) does nothing; `report` writes only audit/anomaly `PaymentEvent` rows and never changes payment or certificate state; `apply` also runs the repairs above. `?dryRun=1` writes nothing in either mode.

**Selecting unsettled purchases (Phase 5C-10).** Each run makes one read-only scan of the Razorpay payments created in the window (`fetchRazorpayPaymentsCreatedBetween`, `GET /v1/payments?from&to`, at most 10 pages of 100). Only an order with a captured or an authorized payment can be anything but in sync (C1, C3, C5), so the unsettled phase examines only PENDING/FAILED purchases whose order appears there, with the same age window and 15-minute minimum age. Abandoned checkouts are never read and cannot queue ahead of a missed capture, including a retried order whose `updatedAt` changed. If the scan fails or exceeds its page limit, the run logs a warning (error name/status only) and falls back to examining unsettled purchases oldest-first, as before. No schema change and no stored cursor.

**Idempotency:** repairs are the webhook's own transitions, extracted as `applyCaptureTx` / `applyFullRefundTx` in `payment.service.ts` (same compare-and-set, amount/currency check, refund-wins rule), run in one transaction with their audit event. Audit keys are deterministic `PaymentEvent.providerEventId` values (`recon:*`, distinct from the webhook's `evt:*` / `body:*`); an existing key, or losing the insert race, records and applies nothing. REPORT findings use separate `recon:report:*` keys so they never block a later APPLY. Concurrent runs, the webhook, owner retries and admin revocation converge through the existing compare-and-set; there are no locks. A Razorpay read failure skips that payment. Each run is bounded (25 payments plus the scan, 20 s budget; the route's `maxDuration` is 60 s) and returns/logs counts only, no provider payloads or customer data. The 25 are shared fairly: each of the three phases (unsettled, paid but not issued, issued) first gets an equal share, then the budget a phase did not need goes to the others, so a backlog in one phase (e.g. abandoned checkouts on the oldest-first fallback) cannot starve the later phases.

**Cron endpoint:** `GET /api/cron/reconcile-payments`, `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends), compared in constant time. `CRON_SECRET` unset or shorter than 32 characters → 503; missing/wrong token → 401. Then the query: none, or exactly one `dryRun=1` or `dryRun=0`; anything else (another value, a repeated `dryRun`, any other key such as `dryrun`) → 400 before any work, so a mistyped dry run can never become a real run. GET only: `HEAD` is explicitly 405 (Next.js would otherwise serve HEAD with the GET handler and run a reconciliation); other methods are 405. Not behind the user rate limiter. Its Production schedule is below.

**Before activation (external, not verifiable from the repo):** Razorpay account auto-capture setting; webhook active events (`payment.captured`, `payment.failed`, `refund.processed`) and status; Razorpay webhook retry/disable policy; Vercel plan cron frequency limits (Hobby: daily). Staging environment provisioning and verification remains an external prerequisite; PR #7 provides repository-level environment guards only. Activation order: set `CRON_SECRET` (Production only) → run `report` and review anomalies → add the `crons` entry → `apply` only after the report findings are understood.

**Production schedule (report only).** `vercel.json` has one cron job: `/api/cron/reconcile-payments`, schedule `0 5 * * *` (UTC). The project is on the Hobby plan (daily at most, see above), and Hobby may start a job at any point within the scheduled hour, so it runs once a day between 05:00 and 05:59 UTC. Vercel Cron calls the Production deployment with GET and sends `Authorization: Bearer <CRON_SECRET>` itself; the path has no query, so a scheduled run is never a dry run.

- **Report only.** A run uses the `PAYMENT_RECONCILE_MODE` its deployment was built with. Production stays `report`: the schedule does **not** enable `apply`, and nothing in it changes payment or certificate state.
- **Activation continues:** report → observe (at least 7 consecutive daily runs) → review every finding → a controlled `apply` later (change the mode for Production, redeploy, observe one run). Environment variables are fixed per deployment, so a mode change needs a redeploy, and a deployment built under another mode must never be promoted.
- **Window.** Each run looks back over the 7-day window (stale rows only, 15-minute minimum age), so a missed or failed day is covered by the next run; Vercel does not retry a failed cron invocation.
- **Observation.** Runtime logs are kept only briefly on Hobby: capture each run's `Payment reconciliation run` summary within about an hour (see the runbook below). `PaymentEvent` rows (`recon:*`) are the durable record of findings. The route answers 200 even when individual payments fail, so watch the summary, not the status.
- **Stopping it:** disable Cron Jobs in the Vercel project settings (immediate), then remove the `crons` entry.
- **While frozen:** since 9 October 2026 Production is private (Deployment Protection: All Deployments), so scheduled runs probably receive the login redirect and do nothing (unverified). Re-check the schedule when Production is made public again; see `docs/LAUNCH_CHECKLIST.md`.

### Reconciliation runbook (Phase 5C-11)

**Run summary.** Every run returns and logs one `Payment reconciliation run` entry (counts and ids only, no provider payloads or customer data): `mode`, `dryRun`, `examined`, `counts` (per outcome), `truncated`, `durationMs`, `scan` (`{status: "ok", payments: n}` with the number of payments listed on the whole Razorpay account, `"fallback"` when the scan failed or hit its page limit, `"skipped"` when nothing ran) and `attention`. A clean run has `attention: []` and is logged at `info`; any other run is logged at **`warn`** with the same message, so `vercel logs --environment production --level warning --since 2h` shows exactly the runs to look at.

**Capture after each run** (within about an hour on Hobby):

- `vercel logs --environment production --since 2h --query "Payment reconciliation run" --json`: the summary.
- Read-only SQL on Production: payments and certificates by status with `max("updatedAt")`, and `payment_events` rows with `"providerEventId" LIKE 'recon:%'` since the previous run (count, key prefix, `eventType`, `receivedAt`). Report mode never changes payment or certificate state, so any status change there came from the webhook or a user, not the cron.

**Attention reasons and what to do.** Nothing here is repaired automatically in `report` mode, and a finding is never permission to switch to `apply`.

| `attention`          | Meaning                                                                                                                                                                        | Action                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errors`             | `error` / `razorpay_error` counts: those payments were left unchanged                                                                                                          | A single run: nothing, the next run retries. Repeated: check Razorpay status and the Production key; `error` (not Razorpay) needs the stack in the log                                                                                                   |
| `anomalies`          | Any `anomaly_*` (order/amount/currency mismatch, multiple or missing captures, held for review, authorized-only, refund pending/failed)                                        | Look up the order and payment in the Razorpay dashboard; each is recorded once as `recon:anomaly:*`. Never repaired by the reconciler; decide by hand                                                                                                    |
| `findings`           | Report mode found a capture or full refund the webhook did not apply (`captured_detected`, `refund_detected`), a stuck fulfilment (`fulfillment_pending`), or a partial refund | Confirm in the Razorpay dashboard (exact order, amount, status) and find why the webhook missed it (Razorpay webhook delivery log). A refund finding revokes the certificate once applied, and `REVOKED` is terminal: confirm every refund by hand first |
| `repairs`            | Apply mode changed state (`captured_applied`, `refund_applied`, `fulfilled`)                                                                                                   | Check the `recon:captured` / `recon:refunded` / `recon:fulfilled` rows and the affected payment and certificate                                                                                                                                          |
| `fulfillment_failed` | A paid certificate's PDF could not be stored                                                                                                                                   | It stays `PENDING_FULFILLMENT` and is retried by the next run, a redelivered capture or the owner; check Supabase Storage if it repeats                                                                                                                  |
| `truncated`          | The batch limit (25) or time budget (20 s) stopped the run                                                                                                                     | Once: the next run continues. Repeatedly: check `durationMs` and which outcomes fill the batch; a lasting backlog needs a decision (limit, schedule or code)                                                                                             |
| `scan_fallback`      | The payment scan failed or exceeded 10 pages                                                                                                                                   | Unsettled purchases were examined oldest-first for this run (correct, but abandoned checkouts can delay a missed capture). Repeated: the account's volume or Razorpay's list API is the cause                                                            |
| `scan_volume`        | The scan listed ≥ 500 payments (half its limit)                                                                                                                                | The shared Test Mode account (Preview, staging, local, e2e runs) is filling the scan. Above 1,000 in 7 days every run falls back; reduce test traffic or give Production its own account                                                                 |

**Incidents.**

- **No run that day:** check Vercel → Settings → Cron Jobs (enabled, last invocation). Vercel does not retry a failed invocation; the 7-day look-back covers a missed day. Two or more missed days: investigate before relying on the safety net.
- **503 / 401 / 400 from the route:** 503 means `CRON_SECRET` is missing or shorter than 32 characters in that deployment; 401 means the header does not match (for example the secret changed without a redeploy); 400 means a query was added to the cron path (it must have none).
- **Duplicate or overlapping runs:** safe. Audit keys are unique per payment and action, and every transition is a compare-and-set, so concurrent runs converge (covered by tests); a second summary with `repairs` counts of 0 is expected.
- **Unexpected state change in report mode:** the cron cannot cause it; look at the webhook's `PaymentEvent` rows (`evt:*` / `body:*`) and application logs instead.

**Disable and roll back.** Fastest: disable Cron Jobs in the Vercel project settings (no redeploy). Then, if needed, set `PAYMENT_RECONCILE_MODE=off` for Production and redeploy (environment variables are fixed per deployment), and remove the `crons` entry in a PR. Never promote or roll back to a deployment built under a different mode. In `report` mode stopping mid-run is harmless; in `apply` mode each repair is its own transaction, and a wrongly applied transition can only be undone by hand in the database.

**Apply is a separate, explicit decision.** It needs at least 7 consecutive clean report runs, every finding confirmed by hand, the webhook and auto-capture confirmed, and a controlled first run (mode change, redeploy, one observed run). The cron never switches modes.

## Migration Workflow

`prisma migrate dev` is not used. Its shadow database replays migrations without Prisma's `_prisma_migrations` table, so the applied migration `20260926000000_lock_down_public_schema_data_api` (which enables RLS on that table) fails there with P3006/P1014. That migration is deployed and stays unchanged: editing it would change its checksum, and every database that applied it would then need a reset.

| Where                                           | Command                                                      |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Write a migration                               | `npm run db:migrate:new -- <name>`                           |
| Apply (local dev database, staging, production) | `prisma migrate deploy` — run manually; builds never migrate |
| CI                                              | `npm run db:migrate:check`                                   |

`scripts/prisma-migration.ts` replays every committed migration with `prisma migrate deploy` — which creates `_prisma_migrations` first, as in production — into a throwaway database on a **local** Postgres (`MIGRATION_SCRATCH_SERVER_URL`, default the docker-compose container on port 5434; only `localhost`, `127.0.0.1` and `::1` are accepted, and `host`/`hostaddr`/`service` connection parameters, in any case, are refused), diffs it against `schema.prisma` with `prisma migrate diff --from-url`, and drops it. It never reads `.env`'s database URLs.

- `new` writes `prisma/migrations/<timestamp>_<name>/migration.sql` and appends `ENABLE ROW LEVEL SECURITY` for every table it creates (Database Access Model).
- `check` fails when `schema.prisma` has changes that no migration captures, or when the history does not apply cleanly.
- Applied migrations are immutable: `tests/unit/prismaMigrationWorkflow.test.ts` pins their checksums. Add a new migration once it is deployed there.
- Future migrations must not reference `_prisma_migrations` unguarded.
- `new` with no schema change writes nothing and exits 0; `check` exits non-zero on any uncaptured change or replay failure. The scratch database is dropped in every case (a failed drop is reported). `tests/integration/prisma-migration-workflow-pg.test.ts` runs both commands end to end against the local test Postgres.

## Observability (Phase 5C-4)

- **Logger** (`src/lib/logger.ts`): one JSON line per entry outside development; `warn`/`error` go to stderr, `info`/`debug` to stdout. `logger.error(message, err, context)` serializes `err` (any thrown value) as `name`, `message`, `code`, `status`, Prisma `meta`, `stack` and `cause`, in every environment. Only these fields are copied from an Error, never its other own properties. Logs are server-side only; API responses keep returning `{ error: { requestId, code, message } }`.
- **Redaction** (safety net, not a licence to log secrets): values under sensitive keys (password, secret, token, authorization, cookie, API key, signature, credential, service role, database/direct/redis URL) and credentials inside strings (`scheme://user:password@`, Bearer/Basic tokens, JWTs, `sb_secret_…`, `password=`/`token=` parameters) are replaced with `[REDACTED]` in messages, errors, stacks and context.
- **Route failures:** `logRequestFailure` logs an expected client error (a status below 500, e.g. `ServiceError`) as a warning without a stack, and anything else as an error with full diagnostics. Session create/start and result submit/lookup log with the same `requestId` they return.
- **Prisma** (`src/server/prismaLogging.ts`): `warn`/`error` events are logged in every environment as a redacted, truncated summary, without the source code frame or query arguments (which can contain row values). Unique-constraint and record-not-found failures are expected, handled outcomes and are not logged there; every failure still reaches its caller.
- **`GET /api/health`** checks the database and Redis (a `PING` through the shared rate-limit client, bounded by its command timeout) concurrently and returns `{ status, db, redis, timestamp, latencyMs }`. HTTP 503 only when the database is unreachable. Redis unreachable → HTTP 200 with `status: "degraded"`, `redis: "unavailable"`: rate-limited endpoints fail closed (429) meanwhile, which monitors should alert on, but the app is not reported down. `redis: "not_configured"` only happens outside production. The health check never touches rate-limit keys.
