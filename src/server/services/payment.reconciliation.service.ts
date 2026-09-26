/**
 * Payment reconciliation (certificate purchases).
 *
 * The signed Razorpay webhook is the primary path: it records the capture and
 * fulfils the certificate. This reconciler is the safety net for when that
 * path did not complete (missed or exhausted deliveries). It reads Razorpay
 * (read-only API calls) and compares with the database:
 *
 *   C1  PENDING/FAILED payment, exactly one captured Razorpay payment
 *                                                        → capture transition
 *       …already fully refunded (processed refunds)       → full-refund transition
 *   C2  COMPLETED payment, certificate PENDING_FULFILLMENT → fulfillCertificate()
 *   C3  order / amount / currency differs from the order   → anomaly only
 *       more than one (or no) captured payment             → anomaly only
 *   C4  COMPLETED payment, certificate PENDING_PAYMENT     → anomaly only
 *       (held for review: needs a human decision)
 *   C5  authorized but never captured                      → anomaly only
 *   C6  COMPLETED payment, processed refunds ≥ its amount  → full-refund transition
 *
 * Refunds are decided from the payment's refund records, never from its
 * payment-level refund fields: only refunds with status "processed" count
 * (the webhook likewise acts only on refund.processed). Processed refunds
 * short of the full amount with a pending or failed refund, or any other
 * unclear refund state, are anomalies that change nothing; a partial refund
 * changes nothing.
 *
 * Modes (PAYMENT_RECONCILE_MODE): "off" (default) does nothing; "report"
 * records audit events and anomalies but never changes payment or certificate
 * state; "apply" also runs the transitions above. `dryRun` writes nothing at
 * all and only counts what it finds (as "detected", in either mode).
 *
 * Safety:
 *  - Never creates an order, captures, refunds or charges: only the read-only
 *    fetchRazorpayOrderPayments / fetchRazorpayPayment /
 *    fetchRazorpayPaymentRefunds are called.
 *  - Transitions are the webhook's own (applyCaptureTx / applyFullRefundTx),
 *    with the same compare-and-set, amount/currency check and refund-wins
 *    rule, inside one transaction with their audit event.
 *  - Audit events use deterministic PaymentEvent keys, unique per payment and
 *    action, so concurrent or repeated runs (and the webhook) converge: the
 *    loser of a race does nothing. No locks.
 *  - A Razorpay read failure skips that payment; nothing is changed.
 *  - Bounded: at most `limit` payments (one or two Razorpay reads each) and
 *    `timeBudgetMs` per run, stale payments only (last change older than
 *    `minAgeMs`, created within `maxAgeMs`).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isServiceError, isUniqueViolation } from "@/server/errors";
import {
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  fetchRazorpayPaymentRefunds,
  type RazorpayPaymentSnapshot,
  type RazorpayRefundSnapshot,
} from "./razorpay.service";
import {
  applyCaptureTx,
  applyFullRefundTx,
  orderAmountMismatch,
} from "./payment.service";
import { fulfillCertificate } from "./certificate.service";

export type ReconcileMode = "off" | "report" | "apply";

export const RECONCILE_DEFAULTS = {
  /** Payments examined (and Razorpay reads) per run. */
  limit: 25,
  /** Leave the webhook time to arrive first. */
  minAgeMs: 15 * 60_000,
  maxAgeMs: 7 * 24 * 60 * 60_000,
  /** Stop starting new payments after this; well under the route's maxDuration. */
  timeBudgetMs: 20_000,
} as const;

export type ReconcileOutcome =
  | "in_sync"
  | "captured_detected"
  | "captured_applied"
  | "refund_detected"
  | "refund_applied"
  | "fulfillment_pending"
  | "fulfilled"
  | "fulfillment_failed"
  | "partial_refund"
  | "anomaly_amount_mismatch"
  | "anomaly_currency_mismatch"
  | "anomaly_multiple_captures"
  | "anomaly_held_for_review"
  | "anomaly_authorized_not_captured"
  | "anomaly_order_mismatch"
  | "anomaly_missing_capture"
  | "anomaly_refund_pending"
  | "anomaly_refund_failed"
  | "already_reconciled"
  | "razorpay_error"
  | "error";

export type ReconcileSummary = {
  mode: ReconcileMode;
  dryRun: boolean;
  examined: number;
  counts: Partial<Record<ReconcileOutcome, number>>;
  /** Stopped at the batch limit or time budget; the rest is left for the next run. */
  truncated: boolean;
  durationMs: number;
};

export type ReconcileOptions = {
  mode: ReconcileMode;
  dryRun?: boolean;
  limit?: number;
  now?: Date;
  minAgeMs?: number;
  maxAgeMs?: number;
  timeBudgetMs?: number;
};

/** PAYMENT_RECONCILE_MODE; anything but "report" or "apply" is "off". */
export function reconcileModeFromEnv(): ReconcileMode {
  const raw = getServerEnv().PAYMENT_RECONCILE_MODE?.trim().toLowerCase() ?? "";
  if (raw === "report" || raw === "apply") return raw;
  if (raw !== "" && raw !== "off") {
    logger.warn("Unknown PAYMENT_RECONCILE_MODE; reconciliation is off", {
      value: raw.slice(0, 20),
    });
  }
  return "off";
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

const paymentSelect = {
  id: true,
  orderId: true,
  paymentId: true,
  status: true,
  amount: true,
  currency: true,
  certificateId: true,
  certificate: { select: { certificateId: true, status: true } },
} satisfies Prisma.PaymentSelect;

type Candidate = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

type Window = {
  staleBefore: Date;
  createdAfter: Date;
  /** Payments already examined in this run (a repaired row can match a later phase). */
  seen: string[];
};

/** Unsettled purchases: C1 (and C3/C5 found on the way). */
function findUnsettled(w: Window, take: number) {
  return db.payment.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      certificateId: { not: null },
      id: { notIn: w.seen },
      updatedAt: { lte: w.staleBefore },
      createdAt: { gte: w.createdAfter },
    },
    orderBy: { updatedAt: "asc" },
    take,
    select: paymentSelect,
  });
}

/** Paid, certificate not issued: C2 and C4 (and C6 found on the way). */
function findPaidNotIssued(w: Window, take: number) {
  return db.payment.findMany({
    where: {
      status: "COMPLETED",
      certificate: { status: { in: ["PENDING_FULFILLMENT", "PENDING_PAYMENT"] } },
      id: { notIn: w.seen },
      updatedAt: { lte: w.staleBefore },
      createdAt: { gte: w.createdAfter },
    },
    orderBy: { updatedAt: "asc" },
    take,
    select: paymentSelect,
  });
}

/** Issued certificates, most recent first: C6 (missed full refund). */
function findIssued(w: Window, take: number) {
  return db.payment.findMany({
    where: {
      status: "COMPLETED",
      certificate: { status: "ACTIVE" },
      id: { notIn: w.seen },
      updatedAt: { lte: w.staleBefore },
      createdAt: { gte: w.createdAfter },
    },
    orderBy: { createdAt: "desc" },
    take,
    select: paymentSelect,
  });
}

// ---------------------------------------------------------------------------
// Audit events + transitions
// ---------------------------------------------------------------------------

/** Deterministic PaymentEvent keys (providerEventId). */
export const reconcileKeys = {
  captured: (rzpPaymentId: string) => `recon:captured:${rzpPaymentId}`,
  refunded: (rzpPaymentId: string) => `recon:refunded:${rzpPaymentId}`,
  fulfilled: (rzpPaymentId: string) => `recon:fulfilled:${rzpPaymentId}`,
  /** REPORT-mode findings get their own keys so they never block a later APPLY. */
  report: (kind: "captured" | "refunded" | "fulfillment", subject: string) =>
    `recon:report:${kind}:${subject}`,
  anomaly: (kind: AnomalyKind, subject: string) => `recon:anomaly:${kind}:${subject}`,
};

type AnomalyKind =
  | "amount_mismatch"
  | "currency_mismatch"
  | "order_mismatch"
  | "multiple_captures"
  | "missing_capture"
  | "held_for_review"
  | "authorized_not_captured"
  | "refund_pending"
  | "refund_failed";

type Ctx = { mode: ReconcileMode; dryRun: boolean };

/** Safe, bounded metadata only: no customer details, no raw provider payloads. */
function snapshotMeta(p: RazorpayPaymentSnapshot | undefined) {
  return p
    ? {
        razorpayPaymentId: p.id,
        razorpayStatus: p.status,
        amount: p.amount,
        currency: p.currency,
        captured: p.captured,
        amountRefunded: p.amountRefunded,
        refundStatus: p.refundStatus,
      }
    : {};
}

/** The snapshot as a Razorpay payment entity, for the shared transitions. */
function toEntity(p: RazorpayPaymentSnapshot): Record<string, unknown> {
  return {
    id: p.id,
    order_id: p.orderId,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    captured: p.captured,
    amount_refunded: p.amountRefunded,
    refund_status: p.refundStatus,
  };
}

type RecordResult = { recorded: boolean; transitioned: boolean };

/**
 * Records the audit event `key` and, in the same transaction, runs `apply`
 * against the freshly read payment row. Exactly once per key: an existing
 * key, or losing the insert race to a concurrent run, records and applies
 * nothing.
 */
async function recordOnce(
  payment: Candidate,
  key: string,
  eventType: string,
  meta: Record<string, unknown>,
  apply?: (
    tx: Prisma.TransactionClient,
    fresh: Parameters<typeof applyCaptureTx>[1]
  ) => Promise<boolean>
): Promise<RecordResult> {
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.paymentEvent.findUnique({
        where: { providerEventId: key },
        select: { id: true },
      });
      if (existing) return { recorded: false, transitioned: false };

      const fresh = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          certificateId: true,
        },
      });
      const transitioned = apply ? await apply(tx, fresh) : false;

      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          provider: "RAZORPAY",
          providerEventId: key,
          eventType,
          payload: {
            source: "reconciliation",
            orderId: payment.orderId,
            statusBefore: fresh.status,
            transitioned,
            ...meta,
          } as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
      return { recorded: true, transitioned };
    });
  } catch (error) {
    if (isUniqueViolation(error, "providerEventId")) {
      return { recorded: false, transitioned: false };
    }
    throw error;
  }
}

async function anomaly(
  ctx: Ctx,
  payment: Candidate,
  kind: AnomalyKind,
  subject: string,
  meta: Record<string, unknown>
): Promise<ReconcileOutcome> {
  const outcome = `anomaly_${kind}` as ReconcileOutcome;
  if (ctx.dryRun) return outcome;
  const { recorded } = await recordOnce(
    payment,
    reconcileKeys.anomaly(kind, subject),
    "reconciliation.anomaly",
    { kind, expectedAmount: payment.amount, expectedCurrency: payment.currency, ...meta }
  );
  if (recorded) {
    logger.warn("Payment reconciliation anomaly", {
      kind,
      paymentId: payment.id,
      orderId: payment.orderId,
      razorpayPaymentId: meta.razorpayPaymentId,
    });
  }
  return outcome;
}

/** Fulfils a paid certificate if it is still waiting (idempotent). */
async function fulfill(
  payment: Candidate,
  rzpPaymentId: string
): Promise<ReconcileOutcome> {
  const certificateId = payment.certificate?.certificateId;
  if (!certificateId) return "in_sync";
  try {
    const { status, activated } = await fulfillCertificate(certificateId);
    if (activated) {
      await recordOnce(
        payment,
        reconcileKeys.fulfilled(rzpPaymentId),
        "reconciliation.fulfilled",
        {
          razorpayPaymentId: rzpPaymentId,
          certificateStatus: status,
        }
      );
      logger.info("Payment reconciliation fulfilled a certificate", {
        paymentId: payment.id,
        certificateId,
      });
      return "fulfilled";
    }
    return status === "ACTIVE" ? "already_reconciled" : "in_sync";
  } catch (error) {
    if (isServiceError(error) && error.code === "FULFILLMENT_FAILED") {
      return "fulfillment_failed";
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Provider checks
// ---------------------------------------------------------------------------

/** The Razorpay payment belongs to this order, with its exact amount and currency. */
function providerMismatch(
  payment: Candidate,
  p: RazorpayPaymentSnapshot
): "order_mismatch" | "amount_mismatch" | "currency_mismatch" | null {
  if (p.orderId !== payment.orderId) return "order_mismatch";
  const differs = orderAmountMismatch(toEntity(p), payment);
  return differs ? `${differs}_mismatch` : null;
}

/** Payment-level hint that refunds exist; the decision uses the refund records. */
function hasRefundActivity(p: RazorpayPaymentSnapshot): boolean {
  return p.status === "refunded" || p.refundStatus !== null || p.amountRefunded > 0;
}

export type RefundAssessment =
  | { state: "none" }
  | { state: "partial"; processedAmount: number }
  | { state: "full"; processedAmount: number; refundIds: string[] }
  | { state: "pending"; processedAmount: number }
  | { state: "failed"; processedAmount: number };

/**
 * Classifies a payment's refund records. Only refunds with status
 * "processed" in the payment's currency count towards the refunded amount.
 *
 *  - processed total ≥ amount                   → full (the refund may be applied)
 *  - otherwise, any failed refund               → failed  (anomaly)
 *  - otherwise, any pending or unclear refund   → pending (anomaly)
 *  - otherwise, some processed amount           → partial (no change)
 *  - no refunds                                 → none
 */
export function assessRefunds(
  refunds: RazorpayRefundSnapshot[],
  payment: { amount: number; currency: string }
): RefundAssessment {
  const counted = refunds.filter(
    (r) => r.status === "processed" && r.currency === payment.currency
  );
  const processedAmount = counted.reduce((sum, r) => sum + r.amount, 0);
  if (counted.length > 0 && processedAmount >= payment.amount) {
    return { state: "full", processedAmount, refundIds: counted.map((r) => r.id).sort() };
  }
  const rest = refunds.filter((r) => !counted.includes(r));
  if (rest.some((r) => r.status === "failed"))
    return { state: "failed", processedAmount };
  if (rest.length > 0) return { state: "pending", processedAmount };
  if (processedAmount > 0) return { state: "partial", processedAmount };
  return { state: "none" };
}

/**
 * Reads and classifies the refunds of a captured payment that shows refund
 * activity. A payment-level refund signal without refund records is unclear,
 * so it is reported as pending.
 */
async function refundsOf(p: RazorpayPaymentSnapshot, payment: Candidate) {
  if (!p.captured || !hasRefundActivity(p)) return { state: "none" } as const;
  const assessment = assessRefunds(await fetchRazorpayPaymentRefunds(p.id), payment);
  return assessment.state === "none"
    ? ({ state: "pending", processedAmount: 0 } as const)
    : assessment;
}

async function refund(
  ctx: Ctx,
  payment: Candidate,
  p: RazorpayPaymentSnapshot,
  refunds: Extract<RefundAssessment, { state: "full" }>
): Promise<ReconcileOutcome> {
  if (ctx.dryRun) return "refund_detected";
  const meta = {
    ...snapshotMeta(p),
    processedRefundAmount: refunds.processedAmount,
    refundIds: refunds.refundIds,
  };
  if (ctx.mode === "report") {
    const { recorded } = await recordOnce(
      payment,
      reconcileKeys.report("refunded", p.id),
      "reconciliation.refunded",
      { mode: "report", ...meta }
    );
    if (recorded) {
      logger.warn("Payment reconciliation: full refund not reflected", {
        paymentId: payment.id,
        razorpayPaymentId: p.id,
      });
    }
    return "refund_detected";
  }
  // The webhook's refund.processed transition, given the facts established
  // from the processed refund records (not the payment-level refund fields).
  const entity = {
    ...toEntity(p),
    captured: true,
    amount_refunded: refunds.processedAmount,
    refund_status: "full",
  };
  const refundEntity = {
    status: "processed",
    amount: refunds.processedAmount,
    payment_id: p.id,
  };
  const { recorded, transitioned } = await recordOnce(
    payment,
    reconcileKeys.refunded(p.id),
    "reconciliation.refunded",
    { mode: "apply", ...meta },
    (tx, fresh) => applyFullRefundTx(tx, fresh, entity, refundEntity)
  );
  if (transitioned) {
    logger.warn("Payment reconciliation applied a missed full refund", {
      paymentId: payment.id,
      razorpayPaymentId: p.id,
    });
  }
  return recorded ? "refund_applied" : "already_reconciled";
}

/** Refund outcome for a captured payment, or null to continue with it. */
async function refundOutcome(
  ctx: Ctx,
  payment: Candidate,
  p: RazorpayPaymentSnapshot
): Promise<ReconcileOutcome | "partial" | null> {
  const refunds = await refundsOf(p, payment);
  switch (refunds.state) {
    case "full":
      return refund(ctx, payment, p, refunds);
    case "pending":
    case "failed":
      return anomaly(ctx, payment, `refund_${refunds.state}`, p.id, {
        ...snapshotMeta(p),
        processedRefundAmount: refunds.processedAmount,
      });
    case "partial":
      return "partial";
    case "none":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-payment reconciliation
// ---------------------------------------------------------------------------

/** C1 (with C3, C5 and missed refunds): an unsettled purchase. */
async function reconcileUnsettled(
  ctx: Ctx,
  payment: Candidate
): Promise<ReconcileOutcome> {
  const payments = await fetchRazorpayOrderPayments(payment.orderId);
  const captured = payments.filter((p) => p.captured);

  if (captured.length > 1) {
    return anomaly(ctx, payment, "multiple_captures", payment.orderId, {
      razorpayPaymentIds: captured.map((p) => p.id).sort(),
    });
  }

  const p = captured[0];
  if (!p) {
    const authorized = payments.filter((x) => x.status === "authorized");
    if (authorized.length > 0) {
      return anomaly(ctx, payment, "authorized_not_captured", payment.orderId, {
        razorpayPaymentIds: authorized.map((x) => x.id).sort(),
      });
    }
    return "in_sync"; // nothing was paid (abandoned or failed attempts)
  }

  const mismatch = providerMismatch(payment, p);
  if (mismatch) return anomaly(ctx, payment, mismatch, p.id, snapshotMeta(p));

  // Captured, then fully refunded, with neither webhook applied: refund wins,
  // exactly as when both deliveries arrive. Pending/failed refunds: anomaly.
  const refunded = await refundOutcome(ctx, payment, p);
  if (refunded !== null && refunded !== "partial") return refunded;

  if (p.status !== "captured") {
    // e.g. "refunded" without processed refunds covering it: unclear.
    return anomaly(ctx, payment, "refund_pending", p.id, snapshotMeta(p));
  }

  if (ctx.dryRun) return "captured_detected";

  if (ctx.mode === "report") {
    const { recorded } = await recordOnce(
      payment,
      reconcileKeys.report("captured", p.id),
      "reconciliation.captured",
      { mode: "report", ...snapshotMeta(p) }
    );
    if (recorded) {
      logger.warn("Payment reconciliation: capture not reflected", {
        paymentId: payment.id,
        razorpayPaymentId: p.id,
      });
    }
    return "captured_detected";
  }

  const { recorded, transitioned } = await recordOnce(
    payment,
    reconcileKeys.captured(p.id),
    "reconciliation.captured",
    { mode: "apply", ...snapshotMeta(p) },
    (tx, fresh) => applyCaptureTx(tx, fresh, toEntity(p))
  );
  if (transitioned) {
    logger.warn("Payment reconciliation applied a missed capture", {
      paymentId: payment.id,
      razorpayPaymentId: p.id,
    });
  }

  // As after a webhook capture: fulfil once the capture has committed. A
  // failure leaves the certificate PENDING_FULFILLMENT for the next run.
  const fresh = await db.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: paymentSelect,
  });
  if (
    fresh.status === "COMPLETED" &&
    fresh.certificate?.status === "PENDING_FULFILLMENT"
  ) {
    const fulfilled = await fulfill(fresh, p.id);
    if (fulfilled === "fulfillment_failed") return fulfilled;
  }
  return recorded ? "captured_applied" : "already_reconciled";
}

/**
 * The provider payment of a paid purchase: the recorded one, or, if none was
 * recorded, the order's only captured payment. Never a guess.
 */
async function paidProviderPayment(
  ctx: Ctx,
  payment: Candidate
): Promise<RazorpayPaymentSnapshot | ReconcileOutcome> {
  if (payment.paymentId) return fetchRazorpayPayment(payment.paymentId);
  const captured = (await fetchRazorpayOrderPayments(payment.orderId)).filter(
    (x) => x.captured
  );
  if (captured.length > 1) {
    return anomaly(ctx, payment, "multiple_captures", payment.orderId, {
      razorpayPaymentIds: captured.map((p) => p.id).sort(),
    });
  }
  return captured[0] ?? anomaly(ctx, payment, "missing_capture", payment.orderId, {});
}

/** C2, C4 and C6: a paid purchase. */
async function reconcilePaid(ctx: Ctx, payment: Candidate): Promise<ReconcileOutcome> {
  const p = await paidProviderPayment(ctx, payment);
  if (typeof p === "string") return p;

  const mismatch = providerMismatch(payment, p);
  if (mismatch) return anomaly(ctx, payment, mismatch, p.id, snapshotMeta(p));
  if (!p.captured) {
    return anomaly(ctx, payment, "missing_capture", p.id, snapshotMeta(p));
  }

  const refunded = await refundOutcome(ctx, payment, p);
  if (refunded !== null && refunded !== "partial") return refunded;

  const certificateStatus = payment.certificate?.status;
  if (certificateStatus === "PENDING_PAYMENT") {
    return anomaly(ctx, payment, "held_for_review", p.id, snapshotMeta(p));
  }
  if (certificateStatus === "PENDING_FULFILLMENT") {
    if (ctx.dryRun) return "fulfillment_pending";
    if (ctx.mode === "report") {
      await recordOnce(
        payment,
        reconcileKeys.report("fulfillment", p.id),
        "reconciliation.fulfillment_pending",
        { mode: "report", ...snapshotMeta(p) }
      );
      return "fulfillment_pending";
    }
    return fulfill(payment, p.id);
  }
  return refunded === "partial" ? "partial_refund" : "in_sync";
}

function errorSummary(error: unknown) {
  const e = error as { name?: unknown; statusCode?: unknown; error?: { code?: unknown } };
  return {
    name: typeof e?.name === "string" ? e.name : undefined,
    statusCode: typeof e?.statusCode === "number" ? e.statusCode : undefined,
    code: typeof e?.error?.code === "string" ? e.error.code : undefined,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export async function reconcilePayments(
  options: ReconcileOptions
): Promise<ReconcileSummary> {
  const started = Date.now();
  const ctx: Ctx = { mode: options.mode, dryRun: options.dryRun ?? false };
  const limit = Math.max(0, options.limit ?? RECONCILE_DEFAULTS.limit);
  const budget = options.timeBudgetMs ?? RECONCILE_DEFAULTS.timeBudgetMs;
  const now = options.now ?? new Date();
  const window: Window = {
    staleBefore: new Date(
      now.getTime() - (options.minAgeMs ?? RECONCILE_DEFAULTS.minAgeMs)
    ),
    createdAfter: new Date(
      now.getTime() - (options.maxAgeMs ?? RECONCILE_DEFAULTS.maxAgeMs)
    ),
    seen: [],
  };

  const summary: ReconcileSummary = {
    mode: ctx.mode,
    dryRun: ctx.dryRun,
    examined: 0,
    counts: {},
    truncated: false,
    durationMs: 0,
  };
  const count = (outcome: ReconcileOutcome) => {
    summary.counts[outcome] = (summary.counts[outcome] ?? 0) + 1;
  };

  if (ctx.mode === "off") {
    summary.durationMs = Date.now() - started;
    return summary;
  }

  const phases: Array<{
    find: (w: Window, take: number) => Promise<Candidate[]>;
    run: (ctx: Ctx, payment: Candidate) => Promise<ReconcileOutcome>;
  }> = [
    { find: findUnsettled, run: reconcileUnsettled },
    { find: findPaidNotIssued, run: reconcilePaid },
    { find: findIssued, run: reconcilePaid },
  ];

  outer: for (const phase of phases) {
    const remaining = limit - summary.examined;
    if (remaining <= 0) {
      summary.truncated = true;
      break;
    }
    const candidates = await phase.find(window, remaining + 1);
    if (candidates.length > remaining) summary.truncated = true;

    for (const payment of candidates.slice(0, remaining)) {
      if (Date.now() - started >= budget) {
        summary.truncated = true;
        break outer;
      }
      summary.examined++;
      window.seen.push(payment.id);
      try {
        count(await phase.run(ctx, payment));
      } catch (error) {
        const razorpay =
          typeof (error as { statusCode?: unknown })?.statusCode === "number";
        count(razorpay ? "razorpay_error" : "error");
        logger.error(
          "Payment reconciliation failed for a payment; left unchanged",
          error instanceof Error ? error : undefined,
          { paymentId: payment.id, orderId: payment.orderId, ...errorSummary(error) }
        );
      }
    }
  }

  summary.durationMs = Date.now() - started;
  logger.info("Payment reconciliation run", { ...summary });
  return summary;
}
