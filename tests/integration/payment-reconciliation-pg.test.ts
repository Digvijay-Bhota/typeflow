/**
 * Payment reconciliation against real Postgres (Phase 5C-5).
 *
 * Razorpay is faked at the read-only wrapper (fetchRazorpayOrderPayments /
 * fetchRazorpayPayment) and the SDK constructor throws, so no request can
 * leave the machine and no order, capture or refund can be created.
 * Certificate storage is the in-memory fake; everything else (Prisma,
 * transactions, compare-and-set, the webhook) is real.
 *
 * Isolation: other test files write payments to the same database
 * concurrently. Every test here ages its own rows to a unique timestamp at
 * least 8 days in the past and reconciles a two-minute window around it, so
 * no other row is ever a candidate.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import Razorpay from "razorpay";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import { processRazorpayWebhook } from "@/server/services/payment.service";
import {
  RECONCILE_DEFAULTS,
  reconcilePayments,
  reconcileKeys,
  type ReconcileMode,
  type ReconcileOptions,
  type ReconcileSummary,
} from "@/server/services/payment.reconciliation.service";
import {
  createRazorpayOrder,
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  fetchRazorpayPaymentRefunds,
  type RazorpayPaymentSnapshot,
  type RazorpayRefundSnapshot,
} from "@/server/services/razorpay.service";
import {
  retryCertificateFulfillment,
  revokeCertificate,
} from "@/server/services/certificate.service";
import { GET as cronRoute } from "@/app/api/cron/reconcile-payments/route";
import { certificateStorage } from "../setup/fakeCertificateStorage";

vi.mock("razorpay", () => ({
  default: vi.fn(() => {
    throw new Error("The Razorpay SDK must not be constructed in tests");
  }),
}));
vi.mock("@/lib/supabase/server", async () => {
  const { fakeSupabaseServer } = await import("../setup/fakeCertificateStorage");
  return fakeSupabaseServer;
});
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/services/razorpay.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/razorpay.service")>()),
  createRazorpayOrder: vi.fn(async () => {
    throw new Error("Reconciliation must never create an order");
  }),
  fetchRazorpayOrderPayments: vi.fn(),
  fetchRazorpayPayment: vi.fn(),
  fetchRazorpayPaymentRefunds: vi.fn(),
}));

const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-only-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-supabase-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-only-razorpay-webhook-secret",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-only-session-secret-not-for-production",
  CERTIFICATE_SIGNING_SECRET: "test-only-certificate-signing-secret-not-for-production",
};

beforeAll(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (!process.env[key]) vi.stubEnv(key, value);
  }
  __clearServerEnvForTesting();
});

afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

// ---------------------------------------------------------------------------
// Fake Razorpay (read side only)
// ---------------------------------------------------------------------------

/** Razorpay's view: payments per order id. */
const razorpay = new Map<string, RazorpayPaymentSnapshot[]>();
let razorpayDown = false;

function rzpPayment(
  orderId: string,
  over: Partial<RazorpayPaymentSnapshot> = {}
): RazorpayPaymentSnapshot {
  return {
    id: `pay_${randomBytes(6).toString("hex")}`,
    orderId,
    status: "captured",
    amount: CERTIFICATE_PRICE_INR,
    currency: "INR",
    captured: true,
    amountRefunded: 0,
    refundStatus: null,
    ...over,
  };
}

/** Razorpay's view: refund records per payment id. */
const refundsByPayment = new Map<string, RazorpayRefundSnapshot[]>();

type RefundSpec = { status: "processed" | "pending" | "failed"; amount: number };

function setRefunds(rp: RazorpayPaymentSnapshot, specs: RefundSpec[]) {
  refundsByPayment.set(
    rp.id,
    specs.map((r, i) => ({
      id: `rfnd_${rp.id.slice(4)}_${i}`,
      paymentId: rp.id,
      status: r.status,
      amount: r.amount,
      currency: "INR",
    }))
  );
}

const PROCESSED_FULL: RefundSpec[] = [
  { status: "processed", amount: CERTIFICATE_PRICE_INR },
];

const outage = () => Object.assign(new Error("Bad gateway"), { statusCode: 502 });

beforeEach(() => {
  vi.clearAllMocks();
  razorpay.clear();
  refundsByPayment.clear();
  razorpayDown = false;
  certificateStorage.failNext = 0;
  certificateStorage.gate = null;
  vi.mocked(fetchRazorpayOrderPayments).mockImplementation(async (orderId) => {
    if (razorpayDown) throw outage();
    return structuredClone(razorpay.get(orderId) ?? []);
  });
  vi.mocked(fetchRazorpayPaymentRefunds).mockImplementation(async (paymentId) => {
    if (razorpayDown) throw outage();
    return structuredClone(refundsByPayment.get(paymentId) ?? []);
  });
  vi.mocked(fetchRazorpayPayment).mockImplementation(async (paymentId) => {
    if (razorpayDown) throw outage();
    for (const list of razorpay.values()) {
      const found = list.find((p) => p.id === paymentId);
      if (found) return structuredClone(found);
    }
    throw Object.assign(new Error("Payment not found"), { statusCode: 400 });
  });
});

afterEach(() => {
  // Nothing may ever create an order or construct the SDK client.
  expect(createRazorpayOrder).not.toHaveBeenCalled();
  expect(Razorpay).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Seed = {
  payment?: "PENDING" | "FAILED" | "COMPLETED" | "REFUNDED";
  certificate?: "PENDING_PAYMENT" | "PENDING_FULFILLMENT" | "ACTIVE" | "REVOKED";
  paymentId?: string | null;
  trusted?: boolean;
};

async function seed(opts: Seed = {}) {
  const tag = randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: {
      authId: randomUUID(),
      email: `recon-${tag}@example.com`,
      displayName: "Recon User",
      // Keep these fixtures out of the shared leaderboard population that other
      // test files query concurrently. It does not affect the trust rule.
      leaderboardOptOut: true,
    },
  });
  const passage = await db.passage.create({
    data: { content: "reconciliation passage", wordCount: 2, charCount: 22 },
  });
  const session = await db.testSession.create({
    data: {
      userId: user.id,
      mode: "TIMED",
      language: "ENGLISH",
      duration: 300,
      trustTier: "CERTIFICATE",
      status: "COMPLETED",
      passageId: passage.id,
      integrityToken: `recon-${tag}`,
      startedAt: new Date(Date.now() - 300_000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      shareId: `recon${tag}`,
      wpm: 50,
      rawWpm: 50,
      netWpm: 50,
      accuracy: 0.98,
      correctChars: 1250,
      incorrectChars: 0,
      totalChars: 1250,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: 300_000,
      duration: 300,
      integrityStatus: "VERIFIED",
      scoringSource: opts.trusted === false ? "CLIENT_COUNTS" : "SERVER_RECONSTRUCTED",
    },
  });
  const certificate = await db.certificate.create({
    data: {
      certificateId: `TF-RC-${tag}`,
      verificationHash: "h".repeat(64),
      userId: user.id,
      resultId: result.id,
      status: opts.certificate ?? "PENDING_PAYMENT",
      testType: "TIMED Typing Assessment",
      language: "ENGLISH",
      duration: 300,
      wpm: 50,
      rawWpm: 50,
      accuracy: 0.98,
    },
  });
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      certificateId: certificate.id,
      orderId: `order_recon_${tag}`,
      amount: CERTIFICATE_PRICE_INR,
      currency: "INR",
      idempotencyKey: `idem_recon_${tag}`,
      status: opts.payment ?? "PENDING",
      paymentId: opts.paymentId ?? null,
    },
  });
  return {
    tag,
    userId: user.id,
    orderId: payment.orderId,
    paymentRowId: payment.id,
    certificateRowId: certificate.id,
    certificateId: certificate.certificateId,
  };
}

type Purchase = Awaited<ReturnType<typeof seed>>;

let windowIndex = 0;

/** A fresh, isolated time window more than 7 days in the past. */
function newWindow() {
  windowIndex++;
  const t0 = new Date(Date.now() - 8 * 24 * 3600_000 - windowIndex * 10 * 60_000);
  return {
    t0,
    /** Reconcile only rows last changed at t0 (±1 minute). */
    opts: (
      mode: ReconcileMode,
      extra: Partial<ReconcileOptions> = {}
    ): ReconcileOptions => ({
      mode,
      now: new Date(t0.getTime() + 16 * 60_000),
      maxAgeMs: 17 * 60_000,
      ...extra,
    }),
  };
}

/** Makes a purchase look stale: created and last changed at `at`. */
async function age(p: Purchase, at: Date) {
  await db.$executeRaw`UPDATE payments SET "createdAt" = ${at}, "updatedAt" = ${at} WHERE id = ${p.paymentRowId}::uuid`;
}

async function state(p: Purchase) {
  const [payment, certificate, events] = await Promise.all([
    db.payment.findUniqueOrThrow({ where: { id: p.paymentRowId } }),
    db.certificate.findUniqueOrThrow({ where: { id: p.certificateRowId } }),
    db.paymentEvent.findMany({
      where: { paymentId: p.paymentRowId },
      orderBy: { receivedAt: "asc" },
    }),
  ]);
  return {
    payment: payment.status,
    paymentId: payment.paymentId,
    certificate: certificate.status,
    keys: events.map((e) => e.providerEventId).sort(),
    events,
  };
}

const total = (s: ReconcileSummary) =>
  Object.values(s.counts).reduce((a, b) => a + (b ?? 0), 0);

// Webhook deliveries (Razorpay's documented shape, HMAC-signed).
function signed(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET as string)
    .update(raw)
    .digest("hex");
  return { payload, raw, signature };
}

function captureDelivery(p: Purchase, rp: RazorpayPaymentSnapshot) {
  return signed({
    entity: "event",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: rp.id,
          entity: "payment",
          order_id: p.orderId,
          amount: rp.amount,
          currency: rp.currency,
          status: "captured",
        },
      },
    },
    created_at: 1790200000,
  });
}

function refundDelivery(p: Purchase, rp: RazorpayPaymentSnapshot) {
  return signed({
    entity: "event",
    event: "refund.processed",
    contains: ["refund", "payment"],
    payload: {
      refund: {
        entity: {
          id: `rfnd_${p.tag}`,
          entity: "refund",
          amount: rp.amount,
          currency: "INR",
          payment_id: rp.id,
          status: "processed",
        },
      },
      payment: {
        entity: {
          id: rp.id,
          entity: "payment",
          order_id: p.orderId,
          amount: rp.amount,
          currency: "INR",
          status: "refunded",
          captured: true,
          amount_refunded: rp.amount,
          refund_status: "full",
        },
      },
    },
    created_at: 1790200500,
  });
}

const deliver = (d: ReturnType<typeof signed>, eventId: string) =>
  processRazorpayWebhook(d.payload, d.signature, d.raw, eventId);

// ---------------------------------------------------------------------------
// C1 — missed capture
// ---------------------------------------------------------------------------

describe("C1: captured on Razorpay, webhook missed", () => {
  it("REPORT records the finding once and changes no payment or certificate state", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);

    const first = await reconcilePayments(w.opts("report"));
    await age(p, w.t0);
    const second = await reconcilePayments(w.opts("report"));

    expect(first.counts).toEqual({ captured_detected: 1 });
    expect(second.counts).toEqual({ captured_detected: 1 });
    const s = await state(p);
    expect(s.payment).toBe("PENDING");
    expect(s.certificate).toBe("PENDING_PAYMENT");
    expect(s.keys).toEqual([reconcileKeys.report("captured", rp.id)]);
    expect(s.events[0]!.eventType).toBe("reconciliation.captured");
  });

  it("APPLY runs the capture transition and fulfils the certificate", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);

    const summary = await reconcilePayments(w.opts("apply"));

    expect(summary.counts).toEqual({ captured_applied: 1 });
    const s = await state(p);
    expect(s).toMatchObject({
      payment: "COMPLETED",
      paymentId: rp.id,
      certificate: "ACTIVE",
    });
    expect(s.keys).toEqual(
      [reconcileKeys.captured(rp.id), reconcileKeys.fulfilled(rp.id)].sort()
    );
    // Safe metadata only.
    const payload = s.events.find(
      (e) => e.providerEventId === reconcileKeys.captured(rp.id)
    )!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      source: "reconciliation",
      mode: "apply",
      orderId: p.orderId,
      razorpayPaymentId: rp.id,
      statusBefore: "PENDING",
      transitioned: true,
    });
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(1);
  });

  it("fixture users are opted out of the leaderboard, which does not affect the trust rule", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [rzpPayment(p.orderId)]);
    await age(p, w.t0);

    const user = await db.user.findUniqueOrThrow({ where: { id: p.userId } });
    expect(user.leaderboardOptOut).toBe(true);
    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      captured_applied: 1,
    });
    expect((await state(p)).certificate).toBe("ACTIVE");
  });

  it("a REPORT finding does not block a later APPLY", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [rzpPayment(p.orderId)]);
    await age(p, w.t0);
    await reconcilePayments(w.opts("report"));
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      captured_applied: 1,
    });
    expect((await state(p)).certificate).toBe("ACTIVE");
  });

  it("repeated APPLY runs are idempotent", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);
    await reconcilePayments(w.opts("apply"));
    const after = await state(p);

    // Force it back into the window as a still-unsettled row would be.
    await db.payment.update({
      where: { id: p.paymentRowId },
      data: { status: "PENDING" },
    });
    await age(p, w.t0);
    const again = await reconcilePayments(w.opts("apply"));
    await db.payment.update({
      where: { id: p.paymentRowId },
      data: { status: "COMPLETED" },
    });

    expect(again.counts).toEqual({ already_reconciled: 1 });
    const s = await state(p);
    expect(s.keys).toEqual(after.keys);
    expect(s.certificate).toBe("ACTIVE");
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(1);
  });

  it("FAILED then captured on the same order is completed", async () => {
    const w = newWindow();
    const p = await seed({ payment: "FAILED" });
    razorpay.set(p.orderId, [
      rzpPayment(p.orderId, { status: "failed", captured: false }),
      rzpPayment(p.orderId),
    ]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      captured_applied: 1,
    });
    expect(await state(p)).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
  });

  it("captured then fully refunded, both webhooks missed: refund wins", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId, {
      status: "refunded",
      amountRefunded: CERTIFICATE_PRICE_INR,
      refundStatus: "full",
    });
    razorpay.set(p.orderId, [rp]);
    setRefunds(rp, PROCESSED_FULL);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      refund_applied: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "REFUNDED", certificate: "REVOKED" });
    expect(s.keys).toEqual([reconcileKeys.refunded(rp.id)]);
  });

  it("nothing paid (abandoned or failed attempts, auto-refunded authorization) changes nothing", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [
      rzpPayment(p.orderId, { status: "failed", captured: false }),
      rzpPayment(p.orderId, {
        status: "refunded",
        captured: false,
        amountRefunded: CERTIFICATE_PRICE_INR,
        refundStatus: "full",
      }),
    ]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({ in_sync: 1 });
    expect(await state(p)).toMatchObject({ payment: "PENDING", keys: [] });
  });
});

// ---------------------------------------------------------------------------
// C2 — stuck fulfillment
// ---------------------------------------------------------------------------

async function seedPaidPendingFulfillment() {
  const rpId = `pay_${randomBytes(6).toString("hex")}`;
  const p = await seed({
    payment: "COMPLETED",
    certificate: "PENDING_FULFILLMENT",
    paymentId: rpId,
  });
  razorpay.set(p.orderId, [rzpPayment(p.orderId, { id: rpId })]);
  return { p, rpId };
}

describe("C2: paid, certificate stuck in PENDING_FULFILLMENT", () => {
  it("REPORT identifies it without fulfilling", async () => {
    const w = newWindow();
    const { p } = await seedPaidPendingFulfillment();
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("report"))).counts).toEqual({
      fulfillment_pending: 1,
    });
    expect((await state(p)).certificate).toBe("PENDING_FULFILLMENT");
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(0);
  });

  it("APPLY fulfils it without touching the payment", async () => {
    const w = newWindow();
    const { p, rpId } = await seedPaidPendingFulfillment();
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({ fulfilled: 1 });
    const s = await state(p);
    expect(s).toMatchObject({
      payment: "COMPLETED",
      paymentId: rpId,
      certificate: "ACTIVE",
    });
    expect(s.keys).toEqual([reconcileKeys.fulfilled(rpId)]);
  });

  it("a storage failure leaves it pending, and a later run succeeds", async () => {
    const w = newWindow();
    const { p } = await seedPaidPendingFulfillment();
    await age(p, w.t0);
    certificateStorage.failNext = 1;

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      fulfillment_failed: 1,
    });
    expect((await state(p)).certificate).toBe("PENDING_FULFILLMENT");

    await age(p, w.t0);
    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({ fulfilled: 1 });
    expect((await state(p)).certificate).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// C3 — anomalies
// ---------------------------------------------------------------------------

describe("C3: anomalies are recorded once and never repaired", () => {
  it.each([
    ["amount", { amount: 1 }, "amount_mismatch"],
    ["currency", { currency: "USD" }, "currency_mismatch"],
  ] as const)("%s mismatch → anomaly only", async (_label, over, kind) => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId, over);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);

    for (const mode of ["report", "apply", "apply"] as const) {
      await age(p, w.t0);
      expect((await reconcilePayments(w.opts(mode))).counts).toEqual({
        [`anomaly_${kind}`]: 1,
      });
    }
    const s = await state(p);
    expect(s).toMatchObject({ payment: "PENDING", certificate: "PENDING_PAYMENT" });
    expect(s.keys).toEqual([reconcileKeys.anomaly(kind, rp.id)]);
    expect(s.events[0]!.payload).toMatchObject({
      kind,
      expectedAmount: CERTIFICATE_PRICE_INR,
      expectedCurrency: "INR",
      razorpayPaymentId: rp.id,
      transitioned: false,
    });
  });

  it("more than one captured payment on the order → anomaly only", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [rzpPayment(p.orderId), rzpPayment(p.orderId)]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      anomaly_multiple_captures: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "PENDING", certificate: "PENDING_PAYMENT" });
    expect(s.keys).toEqual([reconcileKeys.anomaly("multiple_captures", p.orderId)]);
  });
});

// ---------------------------------------------------------------------------
// C4 / C5
// ---------------------------------------------------------------------------

describe("C4: paid but held for review", () => {
  it("is reported as an anomaly and never forced, in either mode", async () => {
    const w = newWindow();
    const rpId = `pay_${randomBytes(6).toString("hex")}`;
    const p = await seed({
      payment: "COMPLETED",
      certificate: "PENDING_PAYMENT",
      paymentId: rpId,
      trusted: false,
    });
    razorpay.set(p.orderId, [rzpPayment(p.orderId, { id: rpId })]);

    for (const mode of ["report", "apply"] as const) {
      await age(p, w.t0);
      expect((await reconcilePayments(w.opts(mode))).counts).toEqual({
        anomaly_held_for_review: 1,
      });
    }
    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "PENDING_PAYMENT" });
    expect(s.keys).toEqual([reconcileKeys.anomaly("held_for_review", rpId)]);
  });
});

describe("C5: authorized but never captured", () => {
  it("is reported only; nothing is captured", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [
      rzpPayment(p.orderId, { status: "authorized", captured: false }),
    ]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      anomaly_authorized_not_captured: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "PENDING", certificate: "PENDING_PAYMENT" });
    expect(s.keys).toEqual([reconcileKeys.anomaly("authorized_not_captured", p.orderId)]);
  });
});

// ---------------------------------------------------------------------------
// C6 — missed refund
// ---------------------------------------------------------------------------

async function seedIssued(
  refund: Partial<RazorpayPaymentSnapshot>,
  refunds: RefundSpec[] = []
) {
  const rpId = `pay_${randomBytes(6).toString("hex")}`;
  const p = await seed({ payment: "COMPLETED", certificate: "ACTIVE", paymentId: rpId });
  const rp = rzpPayment(p.orderId, { id: rpId, ...refund });
  razorpay.set(p.orderId, [rp]);
  setRefunds(rp, refunds);
  return { p, rp };
}

const FULL_REFUND = {
  status: "refunded",
  amountRefunded: CERTIFICATE_PRICE_INR,
  refundStatus: "full",
} as const;

describe("C6: full refund on Razorpay, refund webhook missed", () => {
  it("REPORT flags it without revoking", async () => {
    const w = newWindow();
    const { p, rp } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("report"))).counts).toEqual({
      refund_detected: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
    expect(s.keys).toEqual([reconcileKeys.report("refunded", rp.id)]);
  });

  it("APPLY refunds and revokes through the webhook's transition, once", async () => {
    const w = newWindow();
    const { p, rp } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      refund_applied: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "REFUNDED", certificate: "REVOKED" });
    expect(s.keys).toEqual([reconcileKeys.refunded(rp.id)]);
    const cert = await db.certificate.findUniqueOrThrow({
      where: { id: p.certificateRowId },
    });
    expect(cert.revokedReason).toBe("REFUND: payment refunded");
  });

  it("a partial refund changes nothing", async () => {
    const w = newWindow();
    const { p } = await seedIssued({ amountRefunded: 100, refundStatus: "partial" }, [
      { status: "processed", amount: 100 },
    ]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      partial_refund: 1,
    });
    expect(await state(p)).toMatchObject({
      payment: "COMPLETED",
      certificate: "ACTIVE",
      keys: [],
    });
  });

  it("an issued, unrefunded purchase is in sync", async () => {
    const w = newWindow();
    const { p } = await seedIssued({});
    await age(p, w.t0);
    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({ in_sync: 1 });
  });
});

// ---------------------------------------------------------------------------
// Refund records decide (C1 captured-then-refunded, C6 missed refund)
// ---------------------------------------------------------------------------

const HALF = Math.floor(CERTIFICATE_PRICE_INR / 2);

type RefundCase = {
  name: string;
  /** Payment-level fields, as Razorpay would show them; only a hint. */
  hint: Partial<RazorpayPaymentSnapshot>;
  refunds: RefundSpec[];
  verdict: "refund" | "pending" | "failed" | "partial";
};

const REFUND_CASES: RefundCase[] = [
  {
    name: "A: one processed refund of the full amount",
    hint: FULL_REFUND,
    refunds: PROCESSED_FULL,
    verdict: "refund",
  },
  {
    name: "B: a pending refund",
    hint: FULL_REFUND,
    refunds: [{ status: "pending", amount: CERTIFICATE_PRICE_INR }],
    verdict: "pending",
  },
  {
    name: "C: a failed refund",
    hint: FULL_REFUND,
    refunds: [{ status: "failed", amount: CERTIFICATE_PRICE_INR }],
    verdict: "failed",
  },
  {
    name: "D: a partial processed refund",
    hint: { amountRefunded: 100, refundStatus: "partial" },
    refunds: [{ status: "processed", amount: 100 }],
    verdict: "partial",
  },
  {
    name: "E: one processed and one pending refund",
    hint: FULL_REFUND,
    refunds: [
      { status: "processed", amount: HALF },
      { status: "pending", amount: CERTIFICATE_PRICE_INR - HALF },
    ],
    verdict: "pending",
  },
  {
    name: "F: several processed refunds totalling the amount",
    hint: FULL_REFUND,
    refunds: [
      { status: "processed", amount: HALF },
      { status: "processed", amount: CERTIFICATE_PRICE_INR - HALF },
    ],
    verdict: "refund",
  },
];

describe.each(REFUND_CASES)("refund records — $name", ({ hint, refunds, verdict }) => {
  it("C1 (unsettled purchase): only a fully processed refund is applied; repeat runs change nothing", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId, hint);
    razorpay.set(p.orderId, [rp]);
    setRefunds(rp, refunds);
    await age(p, w.t0);

    const expected = {
      refund: {
        counts: { refund_applied: 1 },
        state: { payment: "REFUNDED", certificate: "REVOKED" },
        keys: [reconcileKeys.refunded(rp.id)],
      },
      pending: {
        counts: { anomaly_refund_pending: 1 },
        state: { payment: "PENDING", certificate: "PENDING_PAYMENT" },
        keys: [reconcileKeys.anomaly("refund_pending", rp.id)],
      },
      failed: {
        counts: { anomaly_refund_failed: 1 },
        state: { payment: "PENDING", certificate: "PENDING_PAYMENT" },
        keys: [reconcileKeys.anomaly("refund_failed", rp.id)],
      },
      // A partially refunded payment is still captured: the capture applies.
      partial: {
        counts: { captured_applied: 1 },
        state: { payment: "COMPLETED", certificate: "ACTIVE" },
        keys: [reconcileKeys.captured(rp.id), reconcileKeys.fulfilled(rp.id)].sort(),
      },
    }[verdict];

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual(expected.counts);
    let s = await state(p);
    expect(s).toMatchObject(expected.state);
    expect(s.keys).toEqual(expected.keys);

    await age(p, w.t0);
    await reconcilePayments(w.opts("apply"));
    s = await state(p);
    expect(s).toMatchObject(expected.state);
    expect(s.keys).toEqual(expected.keys);
  });

  it("C6 (issued certificate): only a fully processed refund revokes; repeat runs change nothing", async () => {
    const w = newWindow();
    const { p, rp } = await seedIssued(hint, refunds);
    await age(p, w.t0);

    const expected = {
      refund: {
        counts: { refund_applied: 1 },
        state: { payment: "REFUNDED", certificate: "REVOKED" },
        keys: [reconcileKeys.refunded(rp.id)],
      },
      pending: {
        counts: { anomaly_refund_pending: 1 },
        state: { payment: "COMPLETED", certificate: "ACTIVE" },
        keys: [reconcileKeys.anomaly("refund_pending", rp.id)],
      },
      failed: {
        counts: { anomaly_refund_failed: 1 },
        state: { payment: "COMPLETED", certificate: "ACTIVE" },
        keys: [reconcileKeys.anomaly("refund_failed", rp.id)],
      },
      partial: {
        counts: { partial_refund: 1 },
        state: { payment: "COMPLETED", certificate: "ACTIVE" },
        keys: [] as string[],
      },
    }[verdict];

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual(expected.counts);
    let s = await state(p);
    expect(s).toMatchObject(expected.state);
    expect(s.keys).toEqual(expected.keys);

    await age(p, w.t0);
    await reconcilePayments(w.opts("apply"));
    s = await state(p);
    expect(s).toMatchObject(expected.state);
    expect(s.keys).toEqual(expected.keys);
  });
});

describe("refund records: unclear provider states never revoke", () => {
  it("a payment-level refund signal without refund records is reported as pending", async () => {
    const w = newWindow();
    const { p, rp } = await seedIssued(FULL_REFUND, []);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      anomaly_refund_pending: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
    expect(s.keys).toEqual([reconcileKeys.anomaly("refund_pending", rp.id)]);
  });

  it("a processed refund in another currency does not count", async () => {
    const w = newWindow();
    const { p } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    refundsByPayment.forEach((list) => list.forEach((r) => (r.currency = "USD")));
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      anomaly_refund_pending: 1,
    });
    expect(await state(p)).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
  });

  it("REPORT with a fully processed refund records the finding only", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId, FULL_REFUND);
    razorpay.set(p.orderId, [rp]);
    setRefunds(rp, PROCESSED_FULL);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("report"))).counts).toEqual({
      refund_detected: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "PENDING", certificate: "PENDING_PAYMENT" });
    expect(s.keys).toEqual([reconcileKeys.report("refunded", rp.id)]);
  });
});

// ---------------------------------------------------------------------------
// Paid path: the provider payment must be this order's, unambiguously
// ---------------------------------------------------------------------------

describe("paid path: provider payment identity", () => {
  it.each([
    ["order", { orderId: "order_someone_else" }, "order_mismatch"],
    ["amount", { amount: 1 }, "amount_mismatch"],
    ["currency", { currency: "USD" }, "currency_mismatch"],
  ] as const)(
    "%s mismatch on the recorded payment → anomaly only, no fulfilment or revocation",
    async (_label, over, kind) => {
      const w = newWindow();
      const rpId = `pay_${randomBytes(6).toString("hex")}`;
      const p = await seed({
        payment: "COMPLETED",
        certificate: "PENDING_FULFILLMENT",
        paymentId: rpId,
      });
      const rp = rzpPayment(p.orderId, { id: rpId, ...FULL_REFUND, ...over });
      razorpay.set(p.orderId, [rp]);
      setRefunds(rp, PROCESSED_FULL);
      await age(p, w.t0);

      expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
        [`anomaly_${kind}`]: 1,
      });
      const s = await state(p);
      expect(s).toMatchObject({
        payment: "COMPLETED",
        certificate: "PENDING_FULFILLMENT",
      });
      expect(s.keys).toEqual([reconcileKeys.anomaly(kind, rpId)]);
      expect(certificateStorage.uploadsFor(p.certificateId)).toBe(0);
      expect(fetchRazorpayPaymentRefunds).not.toHaveBeenCalled();
    }
  );

  it("no recorded payment id and no captured payment → missing_capture anomaly", async () => {
    const w = newWindow();
    const p = await seed({ payment: "COMPLETED", certificate: "PENDING_FULFILLMENT" });
    razorpay.set(p.orderId, [
      rzpPayment(p.orderId, { status: "failed", captured: false }),
    ]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      anomaly_missing_capture: 1,
    });
    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "PENDING_FULFILLMENT" });
    expect(s.keys).toEqual([reconcileKeys.anomaly("missing_capture", p.orderId)]);
  });

  it("no recorded payment id and several captured payments → multiple_captures anomaly, never the first one", async () => {
    const w = newWindow();
    const p = await seed({ payment: "COMPLETED", certificate: "PENDING_FULFILLMENT" });
    razorpay.set(p.orderId, [rzpPayment(p.orderId), rzpPayment(p.orderId)]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      anomaly_multiple_captures: 1,
    });
    expect(await state(p)).toMatchObject({ certificate: "PENDING_FULFILLMENT" });
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(0);
  });

  it("no recorded payment id and exactly one captured payment → proceeds", async () => {
    const w = newWindow();
    const p = await seed({ payment: "COMPLETED", certificate: "PENDING_FULFILLMENT" });
    razorpay.set(p.orderId, [
      rzpPayment(p.orderId, { status: "failed", captured: false }),
      rzpPayment(p.orderId),
    ]);
    await age(p, w.t0);

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({ fulfilled: 1 });
    expect((await state(p)).certificate).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("reconciler vs webhook capture: one transition, one activation", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);

    await Promise.all([
      reconcilePayments(w.opts("apply")),
      deliver(captureDelivery(p, rp), `evt_cap_${p.tag}`).catch(() => {}),
    ]);
    // Either path may have fulfilled; a redelivery completes it if not.
    await deliver(captureDelivery(p, rp), `evt_cap_${p.tag}`).catch(() => {});

    const s = await state(p);
    expect(s).toMatchObject({
      payment: "COMPLETED",
      paymentId: rp.id,
      certificate: "ACTIVE",
    });
    expect(s.keys).toContain(`evt:evt_cap_${p.tag}`);
    expect(certificateStorage.uploadsFor(p.certificateId)).toBeGreaterThanOrEqual(1);
  });

  it("reconciler capture vs webhook refund: always ends refunded and revoked", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);

    await Promise.all([
      reconcilePayments(w.opts("apply")),
      deliver(refundDelivery(p, rp), `evt_rf_${p.tag}`),
    ]);

    expect(await state(p)).toMatchObject({ payment: "REFUNDED", certificate: "REVOKED" });
  });

  it("reconciler refund vs webhook refund: converge on refunded and revoked", async () => {
    const w = newWindow();
    const { p, rp } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    await age(p, w.t0);

    await Promise.all([
      reconcilePayments(w.opts("apply")),
      deliver(refundDelivery(p, rp), `evt_rf_${p.tag}`),
    ]);

    expect(await state(p)).toMatchObject({ payment: "REFUNDED", certificate: "REVOKED" });
  });

  it("reconciler vs owner retry: activates exactly once", async () => {
    const w = newWindow();
    const { p } = await seedPaidPendingFulfillment();
    await age(p, w.t0);

    const [summary, owner] = await Promise.all([
      reconcilePayments(w.opts("apply")),
      retryCertificateFulfillment(p.userId, p.certificateId),
    ]);

    const activations = (summary.counts.fulfilled ?? 0) + (owner.activated ? 1 : 0);
    expect(activations).toBe(1);
    expect((await state(p)).certificate).toBe("ACTIVE");
  });

  it("reconciler vs admin revocation: never ends active", async () => {
    const w = newWindow();
    const { p } = await seedPaidPendingFulfillment();
    await age(p, w.t0);
    const admin = await db.user.create({
      data: { authId: randomUUID(), email: `admin-${p.tag}@example.com`, role: "ADMIN" },
    });

    await Promise.all([
      reconcilePayments(w.opts("apply")),
      revokeCertificate(admin.id, p.certificateId, "Fraud review"),
    ]);

    expect((await state(p)).certificate).toBe("REVOKED");
  });

  it("two reconciler runs converge: one transition, one audit event per key", async () => {
    const w = newWindow();
    const p = await seed();
    const rp = rzpPayment(p.orderId);
    razorpay.set(p.orderId, [rp]);
    await age(p, w.t0);

    const runs = await Promise.all([
      reconcilePayments(w.opts("apply")),
      reconcilePayments(w.opts("apply")),
    ]);

    expect(runs.reduce((n, r) => n + (r.counts.captured_applied ?? 0), 0)).toBe(1);
    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
    expect(s.keys.filter((k) => k === reconcileKeys.captured(rp.id))).toHaveLength(1);
    expect(s.keys.filter((k) => k === reconcileKeys.fulfilled(rp.id))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Robustness and bounds
// ---------------------------------------------------------------------------

describe("robustness and bounds", () => {
  it("a Razorpay API failure leaves every row unchanged", async () => {
    const w = newWindow();
    const p = await seed();
    const { p: paid } = await seedPaidPendingFulfillment();
    razorpay.set(p.orderId, [rzpPayment(p.orderId)]);
    await age(p, w.t0);
    await age(paid, w.t0);
    razorpayDown = true;

    expect((await reconcilePayments(w.opts("apply"))).counts).toEqual({
      razorpay_error: 2,
    });
    expect(await state(p)).toMatchObject({ payment: "PENDING", keys: [] });
    expect(await state(paid)).toMatchObject({
      certificate: "PENDING_FULFILLMENT",
      keys: [],
    });
  });

  it("dryRun writes nothing, in either mode", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [rzpPayment(p.orderId, { amount: 1 })]);
    const q = await seed();
    razorpay.set(q.orderId, [rzpPayment(q.orderId)]);
    await age(p, w.t0);
    await age(q, w.t0);

    for (const mode of ["report", "apply"] as const) {
      const s = await reconcilePayments(w.opts(mode, { dryRun: true }));
      expect(s).toMatchObject({ dryRun: true });
      expect(s.counts).toEqual({ anomaly_amount_mismatch: 1, captured_detected: 1 });
    }
    expect(await state(p)).toMatchObject({ payment: "PENDING", keys: [] });
    expect(await state(q)).toMatchObject({ payment: "PENDING", keys: [] });
  });

  it("off does nothing at all", async () => {
    const w = newWindow();
    const p = await seed();
    razorpay.set(p.orderId, [rzpPayment(p.orderId)]);
    await age(p, w.t0);

    const s = await reconcilePayments(w.opts("off"));
    expect(s).toMatchObject({ mode: "off", examined: 0, counts: {} });
    expect(fetchRazorpayOrderPayments).not.toHaveBeenCalled();
    expect(await state(p)).toMatchObject({ payment: "PENDING", keys: [] });
  });

  it("enforces the batch limit and reports truncation", async () => {
    const w = newWindow();
    const seeds = [await seed(), await seed(), await seed()];
    for (const p of seeds) {
      razorpay.set(p.orderId, []);
      await age(p, w.t0);
    }

    const s = await reconcilePayments(w.opts("apply", { limit: 2 }));
    expect(s).toMatchObject({ examined: 2, truncated: true });
    expect(total(s)).toBe(2);
    expect(fetchRazorpayOrderPayments).toHaveBeenCalledTimes(2);
  });

  it("enforces the time budget", async () => {
    const w = newWindow();
    const p = await seed();
    await age(p, w.t0);
    const s = await reconcilePayments(w.opts("apply", { timeBudgetMs: 0 }));
    expect(s).toMatchObject({ examined: 0, truncated: true });
  });

  it("only considers stale rows inside the age window", async () => {
    const w = newWindow();
    const fresh = await seed(); // changed "now" relative to the window: too recent
    await age(fresh, new Date(w.t0.getTime() + 5 * 60_000));
    const old = await seed(); // older than maxAge
    await age(old, new Date(w.t0.getTime() - 5 * 60_000));
    for (const p of [fresh, old]) razorpay.set(p.orderId, [rzpPayment(p.orderId)]);

    const s = await reconcilePayments(w.opts("apply"));
    expect(s).toMatchObject({ examined: 0 });
    expect(await state(fresh)).toMatchObject({ payment: "PENDING" });
    expect(await state(old)).toMatchObject({ payment: "PENDING" });
  });
});

// ---------------------------------------------------------------------------
// Fairness across phases (5C-6)
// ---------------------------------------------------------------------------

/**
 * Abandoned checkouts: PENDING, nothing paid on Razorpay. They are never
 * updated again, so they stay the oldest unsettled candidates for 7 days.
 */
async function seedAbandoned(count: number, at: Date) {
  // Sequential: concurrent seeding would hold many connections of the pool
  // that the other test files share.
  const rows: Purchase[] = [];
  for (let i = 0; i < count; i++) {
    const p = await seed();
    razorpay.set(p.orderId, []);
    await age(p, at);
    rows.push(p);
  }
  return rows;
}

// Seeding a full batch of purchases is slow under coverage instrumentation.
describe("fairness across phases", { timeout: 30_000 }, () => {
  it("abandoned checkouts filling the whole batch cannot starve the later phases", async () => {
    const w = newWindow();
    const { limit } = RECONCILE_DEFAULTS;
    const abandoned = await seedAbandoned(limit + 1, w.t0);
    const { p: stuck } = await seedPaidPendingFulfillment();
    const { p: refunded } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    await age(stuck, w.t0);
    await age(refunded, w.t0);

    const s = await reconcilePayments(w.opts("apply"));

    expect(s).toMatchObject({ examined: limit, truncated: true });
    expect(s.counts).toEqual({ fulfilled: 1, refund_applied: 1, in_sync: limit - 2 });
    expect(await state(stuck)).toMatchObject({ certificate: "ACTIVE" });
    expect(await state(refunded)).toMatchObject({
      payment: "REFUNDED",
      certificate: "REVOKED",
    });
    // The abandoned rows used only part of the run, and nothing changed them.
    expect(fetchRazorpayOrderPayments).toHaveBeenCalledTimes(limit - 2);
    for (const p of abandoned) {
      expect(await state(p)).toMatchObject({
        payment: "PENDING",
        certificate: "PENDING_PAYMENT",
        keys: [],
      });
    }
  });

  it("a phase's unused share goes to the others, and no payment is examined twice", async () => {
    const w = newWindow();
    const abandoned = await seedAbandoned(12, w.t0);
    const { p: stuck } = await seedPaidPendingFulfillment();
    await age(stuck, w.t0);

    const s = await reconcilePayments(w.opts("apply", { limit: 10 }));

    expect(s).toMatchObject({ examined: 10, truncated: true });
    expect(s.counts).toEqual({ fulfilled: 1, in_sync: 9 });
    const orders = vi.mocked(fetchRazorpayOrderPayments).mock.calls.map(([o]) => o);
    expect(orders).toHaveLength(9);
    expect(new Set(orders).size).toBe(9);
    const abandonedOrders = new Set(abandoned.map((p) => p.orderId));
    expect(orders.every((o) => abandonedOrders.has(o))).toBe(true);
  });

  it("every phase gets a share even when the limit is smaller than each backlog", async () => {
    const w = newWindow();
    await seedAbandoned(4, w.t0);
    for (let i = 0; i < 2; i++) {
      const { p } = await seedPaidPendingFulfillment();
      await age(p, w.t0);
      const { p: r } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
      await age(r, w.t0);
    }

    const s = await reconcilePayments(w.opts("apply", { limit: 3 }));

    expect(s).toMatchObject({ examined: 3, truncated: true });
    expect(s.counts).toEqual({ in_sync: 1, fulfilled: 1, refund_applied: 1 });
  });

  it("with fewer candidates than the limit, each is examined once and nothing is truncated", async () => {
    const w = newWindow();
    const abandoned = await seedAbandoned(3, w.t0);
    const { p: stuck } = await seedPaidPendingFulfillment();
    const { p: refunded } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    await age(stuck, w.t0);
    await age(refunded, w.t0);

    const s = await reconcilePayments(w.opts("apply"));

    expect(s).toMatchObject({ examined: 5, truncated: false });
    expect(s.counts).toEqual({ in_sync: 3, fulfilled: 1, refund_applied: 1 });
    expect(fetchRazorpayOrderPayments).toHaveBeenCalledTimes(abandoned.length);
  });

  it("dryRun and REPORT reach a starved phase too, and repeated runs stay idempotent", async () => {
    const w = newWindow();
    const limit = 10;
    await seedAbandoned(limit + 1, w.t0);
    const { p: stuck, rpId } = await seedPaidPendingFulfillment();
    await age(stuck, w.t0);
    const reportKey = reconcileKeys.report("fulfillment", rpId);
    const run = (mode: ReconcileMode, dryRun = false) =>
      reconcilePayments(w.opts(mode, { limit, dryRun }));

    const dry = await run("report", true);
    expect(dry.counts.fulfillment_pending).toBe(1);
    expect(await state(stuck)).toMatchObject({
      certificate: "PENDING_FULFILLMENT",
      keys: [],
    });

    for (let i = 0; i < 2; i++) {
      const report = await run("report");
      expect(report.counts.fulfillment_pending).toBe(1);
      expect(await state(stuck)).toMatchObject({
        certificate: "PENDING_FULFILLMENT",
        keys: [reportKey],
      });
    }

    const applied = await run("apply");
    expect(applied.counts.fulfilled).toBe(1);
    const after = await state(stuck);
    expect(after.certificate).toBe("ACTIVE");

    const again = await run("apply");
    expect(again.counts.fulfilled ?? 0).toBe(0);
    expect((await state(stuck)).keys).toEqual(after.keys);
  });
});

// ---------------------------------------------------------------------------
// End to end through the cron route (default window, fake Razorpay)
// ---------------------------------------------------------------------------

describe("end to end: cron route in APPLY mode", () => {
  const CRON_SECRET = "test-only-cron-secret-0123456789abcdef";

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const [key, value] of Object.entries(TEST_ENV)) {
      if (!process.env[key]) vi.stubEnv(key, value);
    }
    __clearServerEnvForTesting();
  });

  it("repairs what is safe, reports the rest, converges on a second run, and logs no secrets", async () => {
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    vi.stubEnv("PAYMENT_RECONCILE_MODE", "apply");
    __clearServerEnvForTesting();

    // One day old: inside the default 7-day window; every other row in the
    // database is either fresh (other files) or older than 8 days (this file).
    const at = new Date(Date.now() - 24 * 3600_000);
    const missed = await seed();
    const missedRp = rzpPayment(missed.orderId);
    razorpay.set(missed.orderId, [missedRp]);
    const mismatch = await seed();
    razorpay.set(mismatch.orderId, [rzpPayment(mismatch.orderId, { amount: 1 })]);
    const { p: stuck } = await seedPaidPendingFulfillment();
    const { p: refunded } = await seedIssued(FULL_REFUND, PROCESSED_FULL);
    const all = [missed, mismatch, stuck, refunded];
    for (const p of all) await age(p, at);

    const logs: string[] = [];
    const capture = (chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }

    const call = () =>
      cronRoute(
        new Request("http://localhost/api/cron/reconcile-payments", {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        })
      );

    const first = await call();
    expect(first.status).toBe(200);
    const body = (await first.json()) as ReconcileSummary;
    expect(body).toMatchObject({ mode: "apply", dryRun: false, examined: 4 });
    expect(body.counts).toEqual({
      captured_applied: 1,
      anomaly_amount_mismatch: 1,
      fulfilled: 1,
      refund_applied: 1,
    });

    expect(await state(missed)).toMatchObject({
      payment: "COMPLETED",
      certificate: "ACTIVE",
    });
    expect(await state(mismatch)).toMatchObject({
      payment: "PENDING",
      certificate: "PENDING_PAYMENT",
    });
    expect(await state(stuck)).toMatchObject({ certificate: "ACTIVE" });
    expect(await state(refunded)).toMatchObject({
      payment: "REFUNDED",
      certificate: "REVOKED",
    });
    const keysAfterFirst = await Promise.all(all.map(async (p) => (await state(p)).keys));

    // Second run over the same rows: nothing new happens.
    for (const p of all) await age(p, at);
    const second = await call();
    const body2 = (await second.json()) as ReconcileSummary;
    expect(body2.counts.captured_applied ?? 0).toBe(0);
    expect(body2.counts.fulfilled ?? 0).toBe(0);
    expect(body2.counts.refund_applied ?? 0).toBe(0);
    expect(await Promise.all(all.map(async (p) => (await state(p)).keys))).toEqual(
      keysAfterFirst
    );

    // Responses carry counts only; logs carry no secret.
    const text = JSON.stringify(body) + JSON.stringify(body2) + logs.join("\n");
    for (const secret of [
      CRON_SECRET,
      process.env.RAZORPAY_KEY_SECRET!,
      process.env.RAZORPAY_WEBHOOK_SECRET!,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(JSON.stringify(body)).not.toContain(missedRp.id);
  });
});
