# TypeFlow Launch Checklist

TypeFlow is **frozen before its paid launch**: no real payments are accepted, and Production is private. This file records the state at the freeze and everything that must happen, in order, before real customers can pay. Each item says why it is needed and how to verify it.

Never put a secret value in this file, a PR, an issue or a log. Refer to secrets by environment-variable name, or by the first 8 hex characters of their SHA-256 fingerprint.

## State at the freeze (9 October 2026)

| Area                   | State                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code                   | `main` at `2e211f0`. Open: PR #57 (draft legal pages, `LEGAL_PAGES_DRAFT = true`, noindex).                                                                                                                                                                                                                                              |
| Hosting                | Vercel **Hobby**, which permits only non-commercial use. Functions run in `bom1` (Mumbai), next to the database.                                                                                                                                                                                                                         |
| Production access      | **Private.** Deployment Protection is _All Deployments_ with Vercel Authentication, which covers Production and every preview. Anonymous requests get a 302 to the Vercel login.                                                                                                                                                         |
| Staging                | `typeflow-staging.vercel.app`, the branch domain of `fix/security-and-e2e-enforcement`. Update it by fast-forwarding that branch to `main`.                                                                                                                                                                                              |
| Protection bypass      | One automation-bypass secret, rotated on 9 October 2026 (fingerprint `980cfd2e`). It is kept in the operator's local `~/.typeflow-vercel-bypass` (mode 0600) and in the Razorpay **Test** webhook URL for staging.                                                                                                                       |
| Database               | Supabase **Free** for both Production and staging, in `ap-south-1`. Free projects pause after a week without activity and have no automatic backups.                                                                                                                                                                                     |
| Payments               | Production and Preview share Razorpay **Test Mode** keys. The monthly Pro subscription (₹499) passed end to end on staging on 9 October 2026: checkout with a recurring test card, signed `subscription.charged`/`authenticated`/`activated` webhooks returning 200, the subscription `ACTIVE` with its billing period, and Pro granted. |
| Payment reconciliation | `vercel.json` schedules `/api/cron/reconcile-payments` daily at `0 5 * * *` UTC; Production is meant to stay in `report` mode (see `ARCHITECTURE.md`). Since Production became private, Vercel's cron requests probably receive the login redirect and do nothing. This is unverified.                                                   |
| Legal pages (PR #57)   | Support email `xvshady585@gmail.com` (confirmed and monitored) and correspondence address with PIN code (confirmed): both final. Every page says the policies have not been reviewed by a lawyer.                                                                                                                                        |

## Resuming work after the freeze

1. **Restore paused databases.** In the Supabase dashboard, restore any paused project. Verify: the project status is `ACTIVE_HEALTHY`.
2. **Check staging.** `curl` staging `/api/health` with the `x-vercel-protection-bypass` header read from `~/.typeflow-vercel-bypass`. Verify: HTTP 200 with `"db":"connected"` and `"redis":"connected"`, and HTTP 302 without the header.
3. **Bring staging up to date.** Fast-forward `fix/security-and-e2e-enforcement` to `main` and push. Verify: the staging deployment is READY at the `main` commit.

## Launch blockers (in order)

Do not accept a real payment until every item is checked.

### 1. Hosting plan that permits commercial use

- **Why:** Vercel's Hobby plan is for non-commercial personal use only, and any way of taking payment from visitors counts as commercial use.
- **Do:** upgrade the team to Vercel Pro (one developer seat), and set a spend alert or a hard limit.
- **Verify:** the team's billing plan reads `pro`.

### 2. Production database plan

- **Why:** a paused database is an outage, and the Free plan keeps no backups of real payments or certificates.
- **Do:** upgrade the Supabase organisation to Pro. Decide whether staging stays in the paid organisation (about $10 a month of compute) or moves to a separate Free organisation.
- **Verify:** the organisation plan reads `pro`, daily backups are listed for Production, and Production is not paused after a week without traffic.

### 3. Production domain, before the first real certificate

- **Why:** every certificate's PDF and QR code embed `APP_URL` permanently, so the domain cannot change after the first real certificate.
- **Do:** choose and connect the domain. Then set `APP_URL` and `NEXT_PUBLIC_APP_URL` for Production, update Supabase Auth's Site URL and redirect URLs, and replace the website URL on the Contact page.
- **Verify:** `APP_URL`'s host equals the domain Vercel reports as the production domain. Otherwise certificate fulfilment refuses to run, by design (`productionAppUrlMismatch`). Sign-up, login and password reset also work on the new domain.

### 4. Legal pages (PR #57)

- **Why:** the policies are drafts.
- **Do:**
  - Get the drafts reviewed by a lawyer, including the leaderboard, result-page and certificate-revocation disclosures.
  - Decide whether a support phone number is required.
  - Confirm the business and tax setup with an adviser.
  - Decide how refund, account-deletion and data-export requests are handled by hand, within the promised response times.
  - Set up complaint tracking for the support inbox.
  - Then remove the drafting notes, set `LEGAL_PAGES_DRAFT = false`, add the five routes to `sitemap.ts`, and merge.
- **Verify:**
  - CI passes.
  - No page shows the draft notice.
  - The pages no longer carry `noindex`.
  - No pre-publication note remains in `src/features/legal/content`.

### 5. Razorpay Live configuration, for Production only

- **Why:** Production must not run on Test keys once it is public. Preview and local development must never get Live keys; `environmentGuard.ts` enforces `rzp_test_` outside Production.
- **Do:**
  1. Add Production-only `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` (Live keys), Live `RAZORPAY_PLAN_ID_PRO_MONTHLY` and `RAZORPAY_PLAN_ID_PRO_YEARLY`, and a Live `RAZORPAY_WEBHOOK_SECRET`.
  2. Keep the Preview values on Test Mode.
  3. Create the Live webhook for `/api/subscription/webhook` (subscription events) and `/api/payment/webhook` (`payment.captured`, `payment.failed`, `refund.processed`).
  4. Check Razorpay's auto-capture setting.
- **Verify:**
  - `vercel env ls production` lists the Production-only variables, and `vercel env ls preview` still has the Test values.
  - The staging guard still starts, which proves Preview still has `rzp_test_` keys.
  - A Live webhook delivery to Production returns 200 and appears in `subscription_events` or `payment_events`.

### 6. Make Production public

- **Why:** Production is private for the freeze.
- **Do:** set Deployment Protection back to _Standard Protection_. Through the API this is `ssoProtection.deploymentType = "prod_deployment_urls_and_all_previews"`.
- **Verify:** an anonymous GET to the production domain's `/` and `/api/health` returns 200, and a preview URL still returns 302.

### 7. Payment reconciliation reaches Production

- **Why:** reconciliation is the safety net for missed certificate-payment webhooks.
- **Do:** confirm that `CRON_SECRET` (at least 32 characters) and `PAYMENT_RECONCILE_MODE=report` are set for Production. Follow `ARCHITECTURE.md` → _Reconciliation runbook_: at least 7 clean daily `report` runs before any `apply`.
- **Verify:** within an hour of the 05:00–05:59 UTC window, the runtime logs show a `Payment reconciliation run` summary with `mode: "report"`. Vercel → Settings → Cron Jobs shows the last invocation.

### 8. Live smoke test, approved by the operator

- **Why:** Test Mode does not prove the Live account, keys, plans and webhooks.
- **Do:** with the operator's approval, make one low-value real Pro subscription and cancel it, and make one certificate purchase. Settle both under the Refund Policy.
- **Verify:**
  - The subscription goes from `TRIALING` to `ACTIVE` with its period dates and grants Pro, then `CANCELLED`.
  - The certificate verifies, and a full refund revokes it.
  - Every step has its webhook event recorded.
  - No manual database change was needed.

## Worth doing before launch (no cost)

- **Subscription reconciliation (report only).** `/api/cron/reconcile-subscriptions` lists local versus Razorpay mismatches, such as a missed activation or cancellation. It never repairs anything. It is off by default (`SUBSCRIPTION_RECONCILE_MODE`) and unscheduled. Before launch, decide whether to enable `report` for Production and how to run it. See `ARCHITECTURE.md` → _Subscription Reconciliation_.
- **Backups while on the Free plan.** Before relying on Free-plan data, take a `pg_dump` of each database and test-restore it locally.

## Only if TypeFlow ever leaves Vercel

These parts of the code depend on Vercel:

- `src/lib/environmentGuard.ts` decides the environment from `VERCEL_ENV`. Elsewhere, `next start` reports `production`, so a staging server would skip the isolation guard.
- Certificate fulfilment's production-URL check reads `VERCEL_PROJECT_PRODUCTION_URL`.
- `src/server/db.ts` adds `pgbouncer=true&connection_limit=1` only when `VERCEL` is set.
- Rate limits key on the raw `x-forwarded-for` header. Vercel sets that header; other proxies may pass through a value the client supplied.
- The `vercel.json` cron, Deployment Protection, per-branch environment variables and preview deployments would all need replacements.

## Rotating the protection bypass secret

Use the Vercel API, `PATCH /v1/projects/<project>/protection-bypass`, and never print a secret:

1. `generate` a new secret, which then coexists with the old one.
2. Write it to `~/.typeflow-vercel-bypass` (mode 0600).
3. Update the Razorpay Test webhook URL's `x-vercel-protection-bypass` value, and confirm its fingerprint.
4. `update` the new secret with `isEnvVar: true`. A revoke does nothing while the old secret is still the environment variable.
5. `revoke` the old secret.

Verify:

- Staging `/api/health` returns 200 with the new secret and 302 without it.
- An unsigned POST to the saved webhook URL returns 401 "Missing signature", not 302.
