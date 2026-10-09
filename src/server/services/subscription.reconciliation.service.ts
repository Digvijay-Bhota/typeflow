/**
 * Subscription reconciliation — REPORT ONLY.
 *
 * Compares local Pro subscriptions with Razorpay, one subscription-ID lookup
 * each, and reports where they disagree: a webhook the app missed (activation,
 * cancellation, halt, renewal), a cancellation Razorpay did not honour, plan or
 * owner mismatches, subscriptions Razorpay does not know, stuck creations and
 * unmatched webhook events. It never repairs anything.
 *
 * Mode (SUBSCRIPTION_RECONCILE_MODE): "off" (default; also any unknown value)
 * does nothing; "report" reads and reports. There is no apply mode.
 *
 * Safety:
 *  - Reads only: subscription and subscriptionEvent, no Prisma writes, no
 *    state transitions, no audit rows. Repeated or concurrent runs are safe.
 *  - The only provider call is fetchRazorpaySubscription (GET by ID). Nothing
 *    is created, charged, cancelled, paused, resumed or refunded.
 *  - Bounded: at most `limit` (≤ 25) lookups per run, each under its own HTTP
 *    deadline (≤ 8 s, aborted and closed when it passes), and never past the
 *    run's time budget (20 s): a lookup gets at most the time left.
 *  - Records changed in the last 15 minutes are skipped (a webhook may still
 *    be on its way).
 *  - Reports identifiers, statuses and dates only: no email, name, notes,
 *    payloads or payment details.
 *
 * Cancellation is at period end (cancelProSubscription), so a locally
 * CANCELLED subscription that Razorpay still shows active is expected until
 * the paid period ends; only 24 hours after the local currentPeriodEnd is it
 * reported as not honoured.
 */
import { db } from "@/server/db";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  fetchRazorpaySubscription,
  RAZORPAY_LOOKUP_TIMEOUT_MS,
  RazorpayLookupError,
  type RazorpayLookupFailure,
  type RazorpaySubscriptionSnapshot,
} from "./razorpay.subscription.service";

export type SubscriptionReconcileMode = "off" | "report";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const SUBSCRIPTION_RECONCILE_DEFAULTS = {
  /** Provider lookups per run (also the maximum). */
  limit: 25,
  /** Leave a webhook time to arrive first. */
  minAgeMs: 15 * 60_000,
  /** Per-lookup HTTP deadline (also the maximum). */
  callTimeoutMs: RAZORPAY_LOOKUP_TIMEOUT_MS,
  /** No lookup starts, or runs, past this. Well under the route's maxDuration. */
  timeBudgetMs: 20_000,
  /** A lookup needs at least this much of the budget to start. */
  minCallMs: 1_000,
  /** After the local currentPeriodEnd, before a still-active cancellation is reported. */
  cancellationGraceMs: DAY_MS,
  /** Cancelled subscriptions are checked until this long after their period end. */
  cancelledLookbackMs: 90 * DAY_MS,
  /** Provider period end later than the local one by more than this: a missed renewal. */
  periodToleranceMs: HOUR_MS,
  /** Identifiers listed for stuck creations and unmatched events. */
  maxListed: 10,
} as const;

/** How the local status compares with Razorpay's. */
export type SubscriptionStatusClass =
  | "in_sync"
  | "missed_activation"
  | "activation_unconfirmed"
  | "missed_cancellation"
  | "missed_halt"
  | "cancellation_pending"
  | "cancellation_not_honoured"
  | "period_stale"
  | "status_conflict";

export type SubscriptionAnomaly = "plan_mismatch" | "owner_mismatch";

export type SubscriptionReconcileOutcome =
  | SubscriptionStatusClass
  | SubscriptionAnomaly
  | "provider_missing"
  | "provider_error"
  | "stuck_creation"
  | "unmatched_events";

export type SubscriptionReconcileAttention =
  | "errors"
  | "findings"
  | "anomalies"
  | "stuck_creation"
  | "unmatched_events"
  | "truncated";

/** One subscription worth a look. Identifiers, statuses and dates only. */
export type SubscriptionFinding = {
  subscriptionId: string;
  providerSubscriptionId: string | null;
  outcomes: SubscriptionReconcileOutcome[];
  localStatus: string;
  providerStatus: string | null;
  localPeriodEnd: string | null;
  providerPeriodEnd: string | null;
  /** provider_error only: what failed, and the HTTP status if there was one. */
  failure?: RazorpayLookupFailure | "unexpected";
  httpStatus?: number | null;
};

export type SubscriptionReconcileSummary = {
  mode: SubscriptionReconcileMode;
  /** Subscriptions due a provider lookup (before the limit). */
  eligible: number;
  /** Provider lookups made. */
  examined: number;
  counts: Partial<Record<SubscriptionReconcileOutcome, number>>;
  findings: SubscriptionFinding[];
  /** Webhook events stored without a local subscription. */
  unmatchedEvents: { count: number; providerSubscriptionIds: string[] };
  /** Stopped at the limit or the time budget; the rest is left for another run. */
  truncated: boolean;
  durationMs: number;
  attention: SubscriptionReconcileAttention[];
};

export type SubscriptionReconcileOptions = {
  mode: SubscriptionReconcileMode;
  limit?: number;
  now?: Date;
  minAgeMs?: number;
  timeBudgetMs?: number;
  callTimeoutMs?: number;
};

/** SUBSCRIPTION_RECONCILE_MODE; anything but "report" is "off". */
export function subscriptionReconcileModeFromEnv(): SubscriptionReconcileMode {
  const raw = getServerEnv().SUBSCRIPTION_RECONCILE_MODE?.trim().toLowerCase() ?? "";
  if (raw === "report") return "report";
  if (raw !== "" && raw !== "off") {
    logger.warn(
      "Unknown SUBSCRIPTION_RECONCILE_MODE; subscription reconciliation is off"
    );
  }
  return "off";
}

// ─── Classification (pure) ────────────────────────────────────────────────────

/** Not paid yet (created, or the mandate authenticated). */
const UNPAID = new Set(["created", "authenticated"]);
/** Razorpay will not charge again. */
const ENDED = new Set(["cancelled", "completed", "expired"]);
/** pending: a charge failed and Razorpay is retrying; the webhook keeps ACTIVE / PAST_DUE. */
const KNOWN = new Set([...UNPAID, ...ENDED, "pending", "active", "halted"]);

export type LocalSubscriptionForReconcile = {
  status: string;
  userId: string;
  providerPlanId: string | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  updatedAt: Date;
};

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const fromUnix = (s: number | null) => (s === null ? null : new Date(s * 1000));

/** Razorpay's paid_count shows at least one charged cycle. Missing or 0 is no evidence. */
const hasPaidCycle = (provider: RazorpaySubscriptionSnapshot) =>
  typeof provider.paidCount === "number" && provider.paidCount > 0;

/**
 * Compare one local subscription with its Razorpay record. The status classes
 * follow the state machine in subscription.service.ts: TRIALING is unpaid,
 * ACTIVE paid, PAST_DUE in grace, CANCELLED ends at the paid period's end.
 *
 * missed_activation needs payment evidence, never Razorpay's status alone:
 *  - TRIALING, Razorpay active: paid_count > 0.
 *  - PAST_DUE, Razorpay active (a recovered payment): paid_count > 0 and a
 *    Razorpay period ending later than the local one (by more than the
 *    tolerance), i.e. a cycle charged after the local paid period; with no
 *    local paid period, paid_count > 0 alone. paid_count counts every charge
 *    ever made, so on its own it cannot show a new payment after the failure.
 * Razorpay active without that evidence (paid_count 0 or missing, or no later
 * period) is activation_unconfirmed: the two disagree, but the provider data
 * does not establish a payment.
 */
export function classifySubscription(
  local: LocalSubscriptionForReconcile,
  provider: RazorpaySubscriptionSnapshot,
  now: Date,
  opts: { graceMs?: number; toleranceMs?: number } = {}
): { status: SubscriptionStatusClass; anomalies: SubscriptionAnomaly[] } {
  const graceMs = opts.graceMs ?? SUBSCRIPTION_RECONCILE_DEFAULTS.cancellationGraceMs;
  const toleranceMs =
    opts.toleranceMs ?? SUBSCRIPTION_RECONCILE_DEFAULTS.periodToleranceMs;
  const p = provider.status;

  let status: SubscriptionStatusClass;
  if (!KNOWN.has(p)) {
    status = "status_conflict";
  } else if (local.status === "TRIALING") {
    if (UNPAID.has(p) || p === "pending") status = "in_sync";
    else if (p === "active") {
      status = hasPaidCycle(provider) ? "missed_activation" : "activation_unconfirmed";
    } else if (p === "halted") status = "missed_halt";
    else status = "missed_cancellation";
  } else if (local.status === "ACTIVE") {
    if (p === "active") {
      const providerEnd = fromUnix(provider.currentEnd);
      const stale =
        local.currentPeriodEnd === null ||
        (providerEnd !== null &&
          providerEnd.getTime() > local.currentPeriodEnd.getTime() + toleranceMs);
      status = stale ? "period_stale" : "in_sync";
    } else if (p === "pending") status = "in_sync";
    else if (p === "halted") status = "missed_halt";
    else if (ENDED.has(p)) status = "missed_cancellation";
    else status = "status_conflict"; // unpaid on Razorpay, paid locally
  } else if (local.status === "PAST_DUE") {
    if (p === "halted" || p === "pending") status = "in_sync";
    else if (p === "active") {
      const providerEnd = fromUnix(provider.currentEnd);
      const newerPaidPeriod =
        local.currentPeriodEnd === null
          ? true
          : providerEnd !== null &&
            providerEnd.getTime() > local.currentPeriodEnd.getTime() + toleranceMs;
      status =
        hasPaidCycle(provider) && newerPaidPeriod
          ? "missed_activation" // a payment after the local paid period: recovered
          : "activation_unconfirmed";
    } else if (ENDED.has(p)) status = "missed_cancellation";
    else status = "status_conflict";
  } else if (local.status === "CANCELLED") {
    if (ENDED.has(p)) {
      status = "in_sync";
    } else {
      // Cancelled at period end: Razorpay keeps it until then.
      const reference = local.currentPeriodEnd ?? local.cancelledAt ?? local.updatedAt;
      status =
        now.getTime() <= reference.getTime() + graceMs
          ? "cancellation_pending"
          : "cancellation_not_honoured";
    }
  } else {
    status = "status_conflict";
  }

  const anomalies: SubscriptionAnomaly[] = [];
  if (
    local.providerPlanId &&
    provider.planId &&
    local.providerPlanId !== provider.planId
  ) {
    anomalies.push("plan_mismatch");
  }
  if (provider.notesUserId && provider.notesUserId !== local.userId) {
    anomalies.push("owner_mismatch");
  }
  return { status, anomalies };
}

const FINDINGS: SubscriptionReconcileOutcome[] = [
  "missed_activation",
  "missed_cancellation",
  "missed_halt",
  "cancellation_not_honoured",
  "period_stale",
];
const ANOMALIES: SubscriptionReconcileOutcome[] = [
  "activation_unconfirmed",
  "plan_mismatch",
  "owner_mismatch",
  "provider_missing",
  "status_conflict",
];

/** What an operator should look at, in a fixed order; empty for a clean run. */
export function subscriptionReconcileAttention(
  s: Pick<SubscriptionReconcileSummary, "counts" | "truncated">
): SubscriptionReconcileAttention[] {
  const n = (o: SubscriptionReconcileOutcome) => s.counts[o] ?? 0;
  const attention: SubscriptionReconcileAttention[] = [];
  if (n("provider_error") > 0) attention.push("errors");
  if (FINDINGS.some((o) => n(o) > 0)) attention.push("findings");
  if (ANOMALIES.some((o) => n(o) > 0)) attention.push("anomalies");
  if (n("stuck_creation") > 0) attention.push("stuck_creation");
  if (n("unmatched_events") > 0) attention.push("unmatched_events");
  if (s.truncated) attention.push("truncated");
  return attention;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const subscriptionSelect = {
  id: true,
  userId: true,
  providerSubscriptionId: true,
  providerPlanId: true,
  status: true,
  currentPeriodEnd: true,
  cancelledAt: true,
  updatedAt: true,
} as const;

/**
 * One bounded, read-only reconciliation pass. In "off" mode it returns an
 * empty summary without touching the database or Razorpay.
 */
export async function reconcileSubscriptions(
  options: SubscriptionReconcileOptions
): Promise<SubscriptionReconcileSummary> {
  const started = Date.now();
  const d = SUBSCRIPTION_RECONCILE_DEFAULTS;
  const counts: SubscriptionReconcileSummary["counts"] = {};
  const findings: SubscriptionFinding[] = [];
  const add = (o: SubscriptionReconcileOutcome, by = 1) => {
    counts[o] = (counts[o] ?? 0) + by;
  };
  const summary: SubscriptionReconcileSummary = {
    mode: options.mode === "report" ? "report" : "off",
    eligible: 0,
    examined: 0,
    counts,
    findings,
    unmatchedEvents: { count: 0, providerSubscriptionIds: [] },
    truncated: false,
    durationMs: 0,
    attention: [],
  };
  if (summary.mode !== "report") {
    summary.durationMs = Date.now() - started;
    return summary;
  }

  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? d.limit)), d.limit);
  const budgetMs = Math.min(options.timeBudgetMs ?? d.timeBudgetMs, d.timeBudgetMs);
  const callTimeoutMs = Math.min(
    options.callTimeoutMs ?? d.callTimeoutMs,
    d.callTimeoutMs
  );
  const cutoff = new Date(now.getTime() - (options.minAgeMs ?? d.minAgeMs));
  const cancelledSince = new Date(now.getTime() - d.cancelledLookbackMs);

  // 1. Subscriptions Razorpay knows about and that can still change.
  const where = {
    plan: "PRO" as const,
    updatedAt: { lte: cutoff },
    providerSubscriptionId: { startsWith: "sub_" },
    OR: [
      { status: { in: ["TRIALING" as const, "ACTIVE" as const, "PAST_DUE" as const] } },
      {
        status: "CANCELLED" as const,
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gte: cancelledSince } }],
      },
    ],
  };
  const [eligible, rows] = await Promise.all([
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit,
      select: subscriptionSelect,
    }),
  ]);
  summary.eligible = eligible;
  summary.truncated = eligible > rows.length;

  for (const row of rows) {
    const remainingMs = budgetMs - (Date.now() - started);
    if (remainingMs < d.minCallMs) {
      summary.truncated = true;
      break;
    }
    const providerSubscriptionId = row.providerSubscriptionId!;
    const base = {
      subscriptionId: row.id,
      providerSubscriptionId,
      localStatus: row.status,
      localPeriodEnd: isoOrNull(row.currentPeriodEnd),
    };
    summary.examined++;

    let provider: RazorpaySubscriptionSnapshot;
    try {
      provider = await fetchRazorpaySubscription(providerSubscriptionId, {
        timeoutMs: Math.min(callTimeoutMs, remainingMs),
      });
    } catch (error) {
      const known = error instanceof RazorpayLookupError;
      if (known && error.kind === "not_found") {
        add("provider_missing");
        findings.push({
          ...base,
          outcomes: ["provider_missing"],
          providerStatus: null,
          providerPeriodEnd: null,
        });
      } else {
        add("provider_error");
        findings.push({
          ...base,
          outcomes: ["provider_error"],
          providerStatus: null,
          providerPeriodEnd: null,
          failure: known ? error.kind : "unexpected",
          httpStatus: known ? error.status : null,
        });
      }
      continue;
    }

    const { status, anomalies } = classifySubscription(row, provider, now);
    add(status);
    for (const a of anomalies) add(a);
    const expected = status === "in_sync" || status === "cancellation_pending";
    if (!expected || anomalies.length > 0) {
      findings.push({
        ...base,
        outcomes: [status, ...anomalies],
        providerStatus: provider.status,
        providerPeriodEnd: isoOrNull(fromUnix(provider.currentEnd)),
      });
    }
  }

  // 2. Creations that never got a Razorpay ID (no provider call needed).
  const stuckWhere = {
    status: "PENDING_CREATION" as const,
    providerSubscriptionId: { startsWith: "pending_" },
    updatedAt: { lte: cutoff },
  };
  const [stuckCount, stuck] = await Promise.all([
    db.subscription.count({ where: stuckWhere }),
    db.subscription.findMany({
      where: stuckWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: d.maxListed,
      select: subscriptionSelect,
    }),
  ]);
  if (stuckCount > 0) add("stuck_creation", stuckCount);
  for (const row of stuck) {
    findings.push({
      subscriptionId: row.id,
      providerSubscriptionId: null,
      outcomes: ["stuck_creation"],
      localStatus: row.status,
      providerStatus: null,
      localPeriodEnd: isoOrNull(row.currentPeriodEnd),
      providerPeriodEnd: null,
    });
  }

  // 3. Webhook events stored without a local subscription.
  const unmatchedWhere = {
    subscriptionId: null,
    providerSubscriptionId: { not: null },
    receivedAt: { lte: cutoff },
  };
  const [unmatchedCount, unmatched] = await Promise.all([
    db.subscriptionEvent.count({ where: unmatchedWhere }),
    db.subscriptionEvent.findMany({
      where: unmatchedWhere,
      distinct: ["providerSubscriptionId"],
      orderBy: { providerSubscriptionId: "asc" },
      take: d.maxListed,
      select: { providerSubscriptionId: true },
    }),
  ]);
  if (unmatchedCount > 0) add("unmatched_events", unmatchedCount);
  summary.unmatchedEvents = {
    count: unmatchedCount,
    providerSubscriptionIds: unmatched
      .map((e) => e.providerSubscriptionId)
      .filter((id): id is string => id !== null),
  };

  summary.durationMs = Date.now() - started;
  summary.attention = subscriptionReconcileAttention(summary);
  if (summary.attention.length > 0) {
    logger.warn("Subscription reconciliation run", { ...summary });
  } else {
    logger.info("Subscription reconciliation run", { ...summary });
  }
  return summary;
}
