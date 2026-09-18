# TypeFlow Architecture

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
