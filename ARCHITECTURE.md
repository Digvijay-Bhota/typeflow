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

**Migrations.** `prisma migrate dev` only against a local Postgres — never a remote or production database. Staging and production use `prisma migrate deploy` only, run manually from `main`; builds never migrate. `migrate dev` currently fails with P3006 on migration `20260926000000_lock_down_public_schema_data_api` (its shadow database has no `_prisma_migrations`); resolving that is a separate task.

**Manual configuration still required (Vercel, external).** Until done, the guard makes misconfigured previews fail by design:

1. Split every variable currently shared by Production and Preview into Production-only and Preview-only records, with Preview pointing at staging: database URLs, Supabase keys, `REDIS_URL`, Razorpay keys/webhook secret/plan IDs, `SESSION_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`.
2. Set `PRODUCTION_SUPABASE_PROJECT_REF` for Preview and Development.
3. Remove the stale `phase-5b-razorpay-validation` branch overrides (`APP_URL`, `NEXT_PUBLIC_APP_URL`, `RAZORPAY_WEBHOOK_SECRET`).

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
