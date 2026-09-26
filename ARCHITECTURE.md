# TypeFlow Architecture

## Database Access Model (Phase 5C-1)

Application data is server-only. The browser never reads or writes application tables.

- **Application tables** (`public` schema) are accessed only by the server through Prisma, connecting as `postgres`, the tables' owner.
- **Supabase** provides Auth (`/auth/v1`, `auth` schema) and Storage (`/storage/v1`, certificate PDFs uploaded with the service-role key). Its Data API (PostgREST) is not used for application data.
- **Data API roles** (`anon`, `authenticated`) have no access to `public` tables. Migration `20260926000000_lock_down_public_schema_data_api` enabled RLS with no policies on every table, and revoked their privileges on tables, sequences, functions and future objects (default privileges). Both layers hold independently: RLS hides rows if a grant reappears, and missing grants deny access (including `TRUNCATE`, which RLS does not cover) if RLS is disabled.
- **Unchanged:** `service_role`, schema `USAGE`, and the `auth`/`storage` schemas. No `FORCE ROW LEVEL SECURITY` (the owner and `BYPASSRLS` roles are exempt).

**Rule for new tables:** every migration that adds a table to `public` must enable RLS on it and add no `anon`/`authenticated` policies. `tests/integration/db-privileges-pg.test.ts` enforces this against a test database that reproduces Supabase's roles and grants (`tests/setup/supabase-roles.sql`).

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

**Idempotency:** repairs are the webhook's own transitions, extracted as `applyCaptureTx` / `applyFullRefundTx` in `payment.service.ts` (same compare-and-set, amount/currency check, refund-wins rule), run in one transaction with their audit event. Audit keys are deterministic `PaymentEvent.providerEventId` values (`recon:*`, distinct from the webhook's `evt:*` / `body:*`); an existing key, or losing the insert race, records and applies nothing. REPORT findings use separate `recon:report:*` keys so they never block a later APPLY. Concurrent runs, the webhook, owner retries and admin revocation converge through the existing compare-and-set; there are no locks. A Razorpay read failure skips that payment. Each run is bounded (25 payments, 20 s budget; the route's `maxDuration` is 60 s) and returns/logs counts only, no provider payloads or customer data.

**Cron endpoint:** `GET /api/cron/reconcile-payments`, `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends), compared in constant time. `CRON_SECRET` unset or shorter than 32 characters → 503; missing/wrong token → 401. Not behind the user rate limiter. **No cron schedule is committed** (`vercel.json` has no `crons`), so merging this does not start any job.

**Before activation (external, not verifiable from the repo):** Razorpay account auto-capture setting; webhook active events (`payment.captured`, `payment.failed`, `refund.processed`) and status; Razorpay webhook retry/disable policy; Vercel plan cron frequency limits (Hobby: daily). Staging environment provisioning and verification remains an external prerequisite; PR #7 provides repository-level environment guards only. Activation order: set `CRON_SECRET` (Production only) → run `report` and review anomalies → add the `crons` entry → `apply` only after the report findings are understood.

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
