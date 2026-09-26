# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TypeFlow — a Next.js 15 (App Router) typing-test platform with server-verified results, certificates (paid PDF + QR verification), Pro subscriptions, and a B2B assessment/recruiting product. Auth via Supabase, database via Prisma/PostgreSQL (Supabase-hosted), payments/subscriptions via Razorpay.

## Commands

```bash
npm run dev              # dev server (Turbopack)
npm run build            # prisma generate + next build
npm run typecheck        # tsc --noEmit
npm run lint              # next lint
npm run lint:fix
npm run format            # prettier --write .
npm run format:check

npm run test              # vitest run (unit + integration, excludes e2e)
npm run test:watch
npm run test:coverage     # coverage gated at 80% lines/functions/statements, 75% branches
npm run test:e2e          # playwright (starts its own dev server)
npm run test:pg           # tests/integration/b2b-pg.test.ts against a real Postgres (used in CI's b2b_tests workflow)

npx vitest run path/to/file.test.ts          # single file
npx vitest run -t "test name substring"      # single test by name
npx playwright test tests/e2e/some.spec.ts   # single e2e spec

npm run db:generate       # prisma generate
npm run db:push           # push schema without migration
npm run db:migrate        # prisma migrate dev
npm run db:studio
npm run db:seed           # tsx prisma/seed.ts

npm run validate          # typecheck + lint + test + build — run before considering work done
```

Test locations: `tests/unit/**`, `tests/integration/**` (vitest, Node env), `src/**/*.test.ts` (co-located unit tests are also picked up), `tests/e2e/**` (Playwright, separate runner). Coverage instrumentation is scoped to `src/features/typing/lib/**` and `src/lib/**` — the pure calculation layer.

## Architecture

**Layering:** `src/app/**` (routes, pages, API route handlers, server actions) → `src/server/services/**` (business logic, one service per domain) → `src/server/db.ts` (Prisma singleton). Route handlers and server actions stay thin: parse/validate input with a Zod schema from `src/schemas/**`, call a service function, return the result. Services are the only layer that should import `@/server/db` directly.

- `src/server/services/` — one file per domain: `session`, `result`, `certificate`, `certificateVerification`, `payment`, `subscription`, `razorpay.service`/`razorpay.subscription.service` (Razorpay SDK wrappers), `organization`, `assessment` (B2B), `practice`, `leaderboard`, `dashboard`, `auth`.
- `src/features/<name>/` — feature-scoped UI + logic (`components/`, `hooks/`, `lib/`). `src/features/typing/lib/` holds the typing engine: `metrics.ts` (WPM/accuracy/consistency formulas), `codeMetrics.ts` (code-mode specific scoring), `passages.ts`. These are pure, deterministic functions — this is the most heavily unit-tested part of the codebase and where the 80% coverage gate lives.
- `src/schemas/` — Zod request schemas shared between client forms and server validation.
- `src/lib/env.ts` — all env vars are validated through Zod at first access (`getServerEnv()` / `getClientEnv()`), not read ad hoc via `process.env`. Server env throws if called from client code. Add new env vars here, not just in `.env.example`.
- `src/lib/constants.ts` — server-authoritative config (pricing in paise, `CHARS_PER_WORD`, enums shared with Prisma schema).
- `src/server/db.ts` — Prisma client singleton; on Vercel it force-appends `connection_limit=1&pgbouncer=true` to the pooled connection string. Never instantiate `PrismaClient` elsewhere.
- `src/server/middleware/rateLimit.ts` — in-memory rate limiter; **throws in production if `REDIS_URL` is unset** (distributed rate limiting is mandatory in prod — this is intentional fail-closed behavior, not a bug to "fix" by removing the check).
- `src/middleware.ts` — sets a per-request CSP nonce, builds a strict CSP header, refreshes the Supabase session, and gates `/dashboard/**` behind auth.

**Trust model (core invariant):** all scoring metrics (WPM, accuracy, consistency) are computed server-side in `resultService`/`metrics.ts` from raw keystroke/event data — client-submitted numbers are never trusted directly. `TestResult.integrityStatus` (`VERIFIED`/`REVIEW`/`INVALID`) and `TrustTier` (`FREE`/`CERTIFICATE`/`B2B_ASSESSMENT`) control how strictly a session's submission is verified; certificate and B2B assessment flows require the higher trust tiers and an `eventTrace`. Session creation issues a random `integrityToken` (see `session.service.ts`) used to prevent replay; keep this pattern for any new scored-submission flow.

**Payments vs. subscriptions:** one-time certificate payments (`Payment`/`PaymentEvent`/`payment.service.ts`, webhook at `/api/payment/webhook`) are a separate model/table/webhook from recurring Pro subscriptions (`Subscription`/`SubscriptionEvent`/`subscription.service.ts`/`razorpay.subscription.service.ts`, webhook at `/api/subscription/webhook`) — see `ARCHITECTURE.md` for the full subscription state machine and entitlement rules (`requirePro(userId)`). Don't merge these concerns; webhook signature verification (raw body + HMAC-SHA256) and idempotency (`idempotencyKey` / `providerEventId`) are required for both, independently.

**B2B/Assessment:** `Organization` → `OrganizationMember` (role-based: OWNER/ADMIN/RECRUITER/REVIEWER/MEMBER) → `Assessment` → `AssessmentCandidate` (invited via hashed token, `inviteTokenHash`) → `AssessmentAttempt` → linked `TestSession`/`TestResult`. Candidate-facing routes live under `/api/assessment-access/[inviteToken]/**` (no login required, token-gated); org-management routes live under `/api/org/[orgId]/**` (session-gated + role-checked in the service layer).

**Auth:** Supabase handles auth; `auth.service.ts#getAuthenticatedUser()` syncs the Supabase user into the Prisma `User` table (`authId` is the FK to `auth.users.id`), upserting on first sight. Always go through this helper rather than reading the Supabase session directly in services.

**Database access is server-only:** application tables in `public` are read and written only by the server through Prisma (the `postgres` role, which owns them). Supabase is used for Auth and Storage only — never `supabase.from(...)`/the Data API for application data, from the browser or the server. Supabase's Data API roles (`anon`, `authenticated`) are locked out by migration `20260926000000_lock_down_public_schema_data_api`: RLS on every table with no policies, and their table/sequence/function privileges and default privileges revoked. **Every migration that adds a table must also `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`** (no policies for `anon`/`authenticated`); `tests/integration/db-privileges-pg.test.ts` fails otherwise. The test database reproduces Supabase's roles and grants before migrating (`tests/setup/supabase-roles.sql`, run by `tests/setup/global-db.ts`, CI and `npm run db:test:migrate`).

## Conventions

- Path alias `@/*` → `src/*`.
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `strict` are all on in `tsconfig.json` — code must handle `undefined` from indexed access and can't pass `undefined` where a key is merely optional.
- ESLint: no unused vars (prefix with `_` to intentionally ignore), no `var`, prefer `const`, `console.log` is a lint error (use `@/lib/logger`; `console.warn`/`error`/`debug` are allowed).
- Prettier + `prettier-plugin-tailwindcss` formats class ordering automatically — run `npm run format` rather than hand-ordering Tailwind classes.
- New scoring/metrics logic belongs in `src/features/typing/lib/` as pure functions with unit tests, matching the existing formula-documentation-comment style in `metrics.ts`.
