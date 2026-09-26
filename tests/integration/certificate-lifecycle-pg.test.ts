/**
 * Certificate lifecycle against real Postgres (Phase 4D step 4):
 * capture → PENDING_FULFILLMENT → (PDF + QR stored) → ACTIVE, retryable
 * fulfillment, status-aware public verification, refund → revocation, admin
 * revocation, and the races between them.
 *
 * Only external services are faked: Supabase Storage (in memory) and Razorpay
 * order creation (must never be called). Webhook deliveries are HMAC-signed
 * with the test secret, in Razorpay's documented payload shape.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import {
  createCertificateOrder,
  processRazorpayWebhook,
} from "@/server/services/payment.service";
import {
  certificateVerifyUrl,
  createCertificate,
  fulfillCertificate,
  getCertificateVerification,
  getOwnerCertificate,
  retryCertificateFulfillment,
  revokeCertificate,
} from "@/server/services/certificate.service";
import { createRazorpayOrder } from "@/server/services/razorpay.service";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { POST as fulfillRoute } from "@/app/api/certificate/fulfill/route";
import { POST as webhookRoute } from "@/app/api/payment/webhook/route";
import VerifyCertificatePage from "@/app/verify/[certificateId]/page";
import LegacyCertificatePage from "@/app/certificate/[id]/page";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import { certificateStorage, publicUrlFor } from "../setup/fakeCertificateStorage";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeSupabaseServer } = await import("../setup/fakeCertificateStorage");
  return fakeSupabaseServer;
});
vi.mock("@/server/services/razorpay.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/razorpay.service")>()),
  createRazorpayOrder: vi.fn(async () => {
    throw new Error("No Razorpay order may be created by the lifecycle");
  }),
}));
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
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

beforeEach(() => {
  certificateStorage.failNext = 0;
  certificateStorage.gate = null;
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A trusted 300 s CERTIFICATE result with a real PENDING_PAYMENT certificate and order. */
async function seedPurchase() {
  const tag = randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: {
      authId: randomUUID(),
      email: `life-${tag}@example.com`,
      displayName: "Pat Typist",
    },
  });
  const passage = await db.passage.create({
    data: { content: "certificate lifecycle passage", wordCount: 3, charCount: 29 },
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
      integrityToken: `life-${tag}`,
      startedAt: new Date(Date.now() - 300_000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      shareId: `life${tag}`,
      wpm: 52,
      rawWpm: 54,
      netWpm: 52,
      accuracy: 0.97,
      correctChars: 1300,
      incorrectChars: 10,
      totalChars: 1310,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: 300_000,
      duration: 300,
      integrityStatus: "VERIFIED",
      scoringSource: "SERVER_RECONSTRUCTED",
    },
  });
  // The real issuance path: real certificate ID and verificationHash.
  const certificate = await createCertificate(user.id, result.id);
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      certificateId: certificate.id,
      orderId: `order_life_${tag}`,
      amount: CERTIFICATE_PRICE_INR,
      currency: "INR",
      idempotencyKey: `idem_life_${tag}`,
      status: "PENDING",
    },
  });
  return {
    tag,
    user,
    resultId: result.id,
    certificate,
    certificateId: certificate.certificateId,
    orderId: payment.orderId,
    paymentRowId: payment.id,
    payId: `pay_life_${tag}`,
  };
}

type Purchase = Awaited<ReturnType<typeof seedPurchase>>;

function signed(payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET as string)
    .update(raw)
    .digest("hex");
  return { payload, raw, signature };
}

function captureEvent(p: Purchase) {
  return signed({
    entity: "event",
    account_id: "acc_TEST000000001",
    event: "payment.captured",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: p.payId,
          entity: "payment",
          order_id: p.orderId,
          amount: CERTIFICATE_PRICE_INR,
          currency: "INR",
          status: "captured",
        },
      },
    },
    created_at: 1790200000,
  });
}

function refundEvent(
  p: Purchase,
  event: "refund.created" | "refund.processed" | "refund.failed",
  opts: { amount?: number; status?: string; captured?: boolean } = {}
) {
  const amount = opts.amount ?? CERTIFICATE_PRICE_INR;
  const full = amount >= CERTIFICATE_PRICE_INR;
  return signed({
    entity: "event",
    account_id: "acc_TEST000000001",
    event,
    contains: ["refund", "payment"],
    payload: {
      refund: {
        entity: {
          id: `rfnd_${p.tag}`,
          entity: "refund",
          amount,
          currency: "INR",
          payment_id: p.payId,
          status:
            opts.status ??
            (event === "refund.processed"
              ? "processed"
              : event === "refund.failed"
                ? "failed"
                : "pending"),
        },
      },
      payment: {
        entity: {
          id: p.payId,
          entity: "payment",
          order_id: p.orderId,
          amount: CERTIFICATE_PRICE_INR,
          currency: "INR",
          status: full && event === "refund.processed" ? "refunded" : "captured",
          captured: opts.captured ?? true,
          amount_refunded: event === "refund.processed" ? amount : 0,
          refund_status:
            event === "refund.processed" ? (full ? "full" : "partial") : null,
        },
      },
    },
    created_at: 1790200500,
  });
}

const deliver = (d: ReturnType<typeof signed>, eventId: string) =>
  processRazorpayWebhook(d.payload, d.signature, d.raw, eventId);

/** Delivery through the real webhook route, as Razorpay sends it. */
const deliverViaRoute = (d: ReturnType<typeof signed>, eventId: string) =>
  webhookRoute(
    new Request("http://localhost/api/payment/webhook", {
      method: "POST",
      headers: { "x-razorpay-signature": d.signature, "x-razorpay-event-id": eventId },
      body: d.raw,
    }) as never
  );

/** A delivery whose post-commit fulfillment failed: Razorpay must redeliver it. */
const FULFILLMENT_FAILED = { code: "FULFILLMENT_FAILED", status: 503 };

async function state(p: Purchase) {
  const [payment, certificate, events, payments] = await Promise.all([
    db.payment.findUniqueOrThrow({ where: { id: p.paymentRowId } }),
    db.certificate.findUniqueOrThrow({ where: { certificateId: p.certificateId } }),
    db.paymentEvent.findMany({ where: { paymentId: p.paymentRowId } }),
    db.payment.count({ where: { certificateId: p.certificate.id } }),
  ]);
  return { payment, certificate, events, payments };
}

/** Captured, but the first PDF upload failed: PENDING_FULFILLMENT. */
async function seedPendingFulfillment() {
  const p = await seedPurchase();
  certificateStorage.failNext = 1;
  await expect(deliver(captureEvent(p), `evt_cap_${p.tag}`)).rejects.toMatchObject(
    FULFILLMENT_FAILED
  );
  expect((await state(p)).certificate.status).toBe("PENDING_FULFILLMENT");
  return p;
}

async function seedActive() {
  const p = await seedPurchase();
  await deliver(captureEvent(p), `evt_cap_${p.tag}`);
  expect((await state(p)).certificate.status).toBe("ACTIVE");
  return p;
}

const expectSameIdentity = (
  after: { certificateId: string; verificationHash: string; issuedAt: Date },
  p: Purchase
) => {
  expect(after.certificateId).toBe(p.certificate.certificateId);
  expect(after.verificationHash).toBe(p.certificate.verificationHash);
  expect(after.issuedAt.toISOString()).toBe(p.certificate.issuedAt.toISOString());
};

// ---------------------------------------------------------------------------
// Capture → fulfillment
// ---------------------------------------------------------------------------

describe("capture → fulfillment", () => {
  it("activates only after the PDF and QR are generated and stored", async () => {
    const p = await seedPurchase();
    await deliver(captureEvent(p), `evt_cap_${p.tag}`);

    const s = await state(p);
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.payment.paymentId).toBe(p.payId);
    expect(s.certificate.status).toBe("ACTIVE");
    expect(s.certificate.pdfUrl).toBe(publicUrlFor(p.certificateId));
    // The QR encodes the canonical verification route.
    expect(s.certificate.qrData).toBe(certificateVerifyUrl(p.certificateId));
    expect(s.certificate.qrData).toMatch(new RegExp(`/verify/${p.certificateId}$`));
    expectSameIdentity(s.certificate, p);

    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(1);
    const pdf = await PDFDocument.load(certificateStorage.objectFor(p.certificateId)!);
    expect(pdf.getPageCount()).toBe(1);

    expect((await getCertificateVerification(p.certificateId))?.state).toBe("VERIFIED");
  });

  it("a duplicate capture delivery does not regenerate or re-transition anything", async () => {
    const p = await seedActive();
    const before = await state(p);

    await deliver(captureEvent(p), `evt_cap_${p.tag}`); // same event id
    await deliver(captureEvent(p), `evt_cap2_${p.tag}`); // replay under a new id

    const after = await state(p);
    expect(after.certificate.status).toBe("ACTIVE");
    expect(after.certificate.updatedAt).toEqual(before.certificate.updatedAt);
    expect(after.payment.updatedAt).toEqual(before.payment.updatedAt);
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(1);
    expect(after.payments).toBe(1);
  });

  it("a PDF/storage failure leaves the payment committed and the certificate pending, not active", async () => {
    const p = await seedPurchase();
    certificateStorage.failNext = 1;

    // The payment is recorded, but the delivery fails so Razorpay redelivers it.
    await expect(deliver(captureEvent(p), `evt_cap_${p.tag}`)).rejects.toMatchObject(
      FULFILLMENT_FAILED
    );

    const s = await state(p);
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.certificate.status).toBe("PENDING_FULFILLMENT");
    expect(s.certificate.pdfUrl).toBeNull();
    expect(s.certificate.qrData).toBeNull();
    expectSameIdentity(s.certificate, p);
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("PROCESSING");
    expect((await getOwnerCertificate(p.user.id, p.resultId)).state).toBe("PROCESSING");
  });

  it("a retry activates the same certificate with no new charge, order or certificate", async () => {
    const p = await seedPendingFulfillment();
    const certificatesBefore = await db.certificate.count({
      where: { resultId: p.resultId },
    });

    const retried = await fulfillCertificate(p.certificateId);

    expect(retried).toEqual({ status: "ACTIVE", activated: true });
    const s = await state(p);
    expect(s.certificate.status).toBe("ACTIVE");
    expectSameIdentity(s.certificate, p);
    expect(s.payment.orderId).toBe(p.orderId);
    expect(s.payments).toBe(1);
    expect(s.events).toHaveLength(1);
    expect(await db.certificate.count({ where: { resultId: p.resultId } })).toBe(
      certificatesBefore
    );
    expect(createRazorpayOrder).not.toHaveBeenCalled();
  });

  it("repeated retries after activation are no-ops that regenerate nothing", async () => {
    const p = await seedPendingFulfillment();
    await fulfillCertificate(p.certificateId);
    const uploads = certificateStorage.uploadsFor(p.certificateId);
    const before = await state(p);

    for (let i = 0; i < 3; i++) {
      expect(await fulfillCertificate(p.certificateId)).toEqual({
        status: "ACTIVE",
        activated: false,
      });
    }

    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(uploads);
    expect((await state(p)).certificate.updatedAt).toEqual(before.certificate.updatedAt);
  });

  it("a failed retry keeps it pending, and a later retry still succeeds", async () => {
    const p = await seedPendingFulfillment();
    certificateStorage.failNext = 1;

    await expect(fulfillCertificate(p.certificateId)).rejects.toMatchObject({
      code: "FULFILLMENT_FAILED",
      status: 503,
    });
    expect((await state(p)).certificate.status).toBe("PENDING_FULFILLMENT");

    expect((await fulfillCertificate(p.certificateId)).status).toBe("ACTIVE");
  });

  it("regression: a failed fulfillment is retried by Razorpay's redelivery of the same capture event, with no owner action", async () => {
    const p = await seedPurchase();
    const capture = captureEvent(p);
    const eventId = `evt_cap_${p.tag}`;

    // 1st delivery: capture settles, fulfillment fails → non-2xx so Razorpay retries.
    certificateStorage.failNext = 1;
    const first = await deliverViaRoute(capture, eventId);
    expect(first.status).toBe(503);
    expect((await first.json()).error.code).toBe("FULFILLMENT_FAILED");
    let s = await state(p);
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.certificate.status).toBe("PENDING_FULFILLMENT");
    expect(s.certificate.pdfUrl).toBeNull();
    const settledAt = s.payment.updatedAt;

    // A redelivery that fails again changes nothing and still asks for a retry.
    certificateStorage.failNext = 1;
    expect((await deliverViaRoute(capture, eventId)).status).toBe(503);
    expect((await state(p)).certificate.status).toBe("PENDING_FULFILLMENT");

    // Next redelivery of the SAME event: financially a duplicate (skipped),
    // but it re-enters fulfillment, which now succeeds.
    const retried = await deliverViaRoute(capture, eventId);
    expect(retried.status).toBe(200);

    s = await state(p);
    expect(s.certificate.status).toBe("ACTIVE");
    expect(s.certificate.pdfUrl).toBe(publicUrlFor(p.certificateId));
    expect(s.certificate.qrData).toBe(certificateVerifyUrl(p.certificateId));
    expectSameIdentity(s.certificate, p);
    // The capture was applied exactly once.
    expect(s.events).toHaveLength(1);
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.payment.updatedAt).toEqual(settledAt);
    // One payment row, the same single Razorpay order, one certificate, no new order.
    expect(s.payments).toBe(1);
    expect(s.payment.orderId).toBe(p.orderId);
    expect(await db.payment.count({ where: { orderId: p.orderId } })).toBe(1);
    expect(await db.certificate.count({ where: { resultId: p.resultId } })).toBe(1);
    expect(createRazorpayOrder).not.toHaveBeenCalled();

    // Duplicate capture after ACTIVE: 200, no regeneration, no state change.
    const uploads = certificateStorage.uploadsFor(p.certificateId);
    const activeAt = s.certificate.updatedAt;
    expect((await deliverViaRoute(capture, eventId)).status).toBe(200);
    expect((await deliverViaRoute(capture, `evt_cap_late_${p.tag}`)).status).toBe(200);
    s = await state(p);
    expect(s.certificate.status).toBe("ACTIVE");
    expect(s.certificate.updatedAt).toEqual(activeAt);
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(uploads);
    expectSameIdentity(s.certificate, p);
  });

  it("a capture for a certificate held for review is acknowledged (no retry loop)", async () => {
    const p = await seedPurchase();
    await db.testResult.update({
      where: { id: p.resultId },
      data: { integrityStatus: "REVIEW" },
    });
    expect((await deliverViaRoute(captureEvent(p), `evt_cap_${p.tag}`)).status).toBe(200);
  });

  it("does not fulfil an unpaid certificate", async () => {
    const p = await seedPurchase();
    expect(await fulfillCertificate(p.certificateId)).toEqual({
      status: "PENDING_PAYMENT",
      activated: false,
    });
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(0);
  });

  it("holds a paid certificate whose result lost its trusted status, and never offers checkout", async () => {
    const p = await seedPurchase();
    await db.testResult.update({
      where: { id: p.resultId },
      data: { integrityStatus: "REVIEW" },
    });

    await deliver(captureEvent(p), `evt_cap_${p.tag}`);

    const s = await state(p);
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.certificate.status).toBe("PENDING_PAYMENT");
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(0);
    expect((await getOwnerCertificate(p.user.id, p.resultId)).state).toBe("PROCESSING");
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("concurrent fulfillment retries activate exactly once", async () => {
    const p = await seedPendingFulfillment();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => fulfillCertificate(p.certificateId))
    );

    expect(results.filter((r) => r.activated)).toHaveLength(1);
    expect(results.every((r) => r.status === "ACTIVE")).toBe(true);
    expectSameIdentity((await state(p)).certificate, p);
  });

  it("capture racing with fulfillment retries ends ACTIVE, activated once", async () => {
    const p = await seedPurchase();

    const [, ...retries] = await Promise.all([
      deliver(captureEvent(p), `evt_cap_${p.tag}`),
      ...Array.from({ length: 3 }, () => fulfillCertificate(p.certificateId)),
    ]);

    expect(retries.filter((r) => r.activated).length).toBeLessThanOrEqual(1);
    const s = await state(p);
    expect(s.certificate.status).toBe("ACTIVE");
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.events).toHaveLength(1);
  });

  it("duplicate webhook deliveries racing each other record one event and one certificate", async () => {
    const p = await seedPurchase();
    const d = captureEvent(p);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => deliver(d, `evt_cap_${p.tag}`))
    );

    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    const s = await state(p);
    expect(s.events).toHaveLength(1);
    expect(s.payments).toBe(1);
    expect(s.certificate.status).toBe("ACTIVE");
    expect(await db.certificate.count({ where: { resultId: p.resultId } })).toBe(1);
  });

  it("a refund committed during fulfillment is never overwritten by activation", async () => {
    const p = await seedPendingFulfillment();
    const held = certificateStorage.hold();

    const fulfilling = fulfillCertificate(p.certificateId);
    await held.reached; // the PDF is being uploaded
    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);
    held.release();

    expect(await fulfilling).toEqual({ status: "REVOKED", activated: false });
    const s = await state(p);
    expect(s.certificate.status).toBe("REVOKED");
    expect(s.payment.status).toBe("REFUNDED");
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("REVOKED");
  });

  it("verification racing a refund only ever reports VERIFIED or REVOKED, then REVOKED", async () => {
    const p = await seedActive();

    const [, ...views] = await Promise.all([
      deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`),
      ...Array.from({ length: 5 }, () => getCertificateVerification(p.certificateId)),
    ]);

    for (const v of views) expect(["VERIFIED", "REVOKED"]).toContain(v?.state);
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("REVOKED");
  });

  it("capture and refund racing always end refunded and revoked", async () => {
    const p = await seedPurchase();

    await Promise.all([
      deliver(captureEvent(p), `evt_cap_${p.tag}`),
      deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`),
    ]);

    const s = await state(p);
    expect(s.payment.status).toBe("REFUNDED");
    expect(s.certificate.status).toBe("REVOKED");
  });

  it("a refund delivered before its capture prevents the late capture from activating", async () => {
    const p = await seedPurchase();
    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);
    await deliver(captureEvent(p), `evt_cap_${p.tag}`);

    const s = await state(p);
    expect(s.payment.status).toBe("REFUNDED");
    expect(s.certificate.status).toBe("REVOKED");
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(0);
  });
});

describe("checkout retries around capture (no second order, charge or certificate)", () => {
  it("capture racing a repeated certificate issuance request keeps one certificate", async () => {
    const p = await seedPurchase();

    const [, ...issued] = await Promise.all([
      deliver(captureEvent(p), `evt_cap_${p.tag}`),
      ...Array.from({ length: 3 }, () => createCertificate(p.user.id, p.resultId)),
    ]);

    for (const c of issued) expect(c.certificateId).toBe(p.certificateId);
    expect(await db.certificate.count({ where: { resultId: p.resultId } })).toBe(1);
    const s = await state(p);
    expect(s.certificate.status).toBe("ACTIVE");
    expectSameIdentity(s.certificate, p);
    expect(s.payments).toBe(1);
  });

  it("a refreshed checkout before capture reuses the same order; the capture completes it", async () => {
    const p = await seedPurchase();

    const again = await createCertificateOrder(p.certificateId, p.user.id);
    expect(again.orderId).toBe(p.orderId);

    await deliver(captureEvent(p), `evt_cap_${p.tag}`);
    const s = await state(p);
    expect(s.certificate.status).toBe("ACTIVE");
    expect(s.payments).toBe(1);
    expect(createRazorpayOrder).not.toHaveBeenCalled();
  });

  it("retrying checkout after capture: same order before the webhook, refused after it", async () => {
    const p = await seedPurchase();

    // Razorpay has captured but the webhook has not arrived: the same (now
    // paid) order is returned, which Razorpay will not charge again.
    expect((await createCertificateOrder(p.certificateId, p.user.id)).orderId).toBe(
      p.orderId
    );

    await deliver(captureEvent(p), `evt_cap_${p.tag}`);
    await expect(
      createCertificateOrder(p.certificateId, p.user.id)
    ).rejects.toMatchObject({ status: 409 });
    expect(await createCertificate(p.user.id, p.resultId)).toMatchObject({
      certificateId: p.certificateId,
      status: "ACTIVE",
    });
    expect((await state(p)).payments).toBe(1);
    expect(createRazorpayOrder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Refund → revocation
// ---------------------------------------------------------------------------

describe("refund → revocation", () => {
  it("a processed full refund revokes an ACTIVE certificate immediately", async () => {
    const p = await seedActive();
    const pdfUrl = (await state(p)).certificate.pdfUrl;

    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);

    const s = await state(p);
    expect(s.payment.status).toBe("REFUNDED");
    expect(s.certificate.status).toBe("REVOKED");
    expect(s.certificate.revokedAt).toBeInstanceOf(Date);
    expect(s.certificate.revokedReason).toMatch(/^REFUND/);
    expect(s.certificate.pdfUrl).toBe(pdfUrl); // nothing regenerated
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(1);
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("REVOKED");
    expect((await getOwnerCertificate(p.user.id, p.resultId)).state).toBe("REVOKED");
  });

  it("duplicate refund deliveries are safe and never reactivate", async () => {
    const p = await seedActive();
    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);
    const first = (await state(p)).certificate;

    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);
    await deliver(refundEvent(p, "refund.processed"), `evt_rf2_${p.tag}`);
    await deliver(captureEvent(p), `evt_cap_late_${p.tag}`);
    expect(await fulfillCertificate(p.certificateId)).toEqual({
      status: "REVOKED",
      activated: false,
    });

    const s = await state(p);
    expect(s.certificate.status).toBe("REVOKED");
    expect(s.certificate.revokedAt).toEqual(first.revokedAt);
    expect(s.certificate.revokedReason).toBe(first.revokedReason);
    expect(s.payment.status).toBe("REFUNDED");
  });

  it.each(["refund.created", "refund.failed"] as const)(
    "%s does not refund or revoke",
    async (event) => {
      const p = await seedActive();
      await deliver(refundEvent(p, event), `evt_${event}_${p.tag}`);

      const s = await state(p);
      expect(s.payment.status).toBe("COMPLETED");
      expect(s.certificate.status).toBe("ACTIVE");
      expect(s.events.map((e) => e.eventType)).toContain(event);
    }
  );

  it("a partial refund is recorded but does not revoke", async () => {
    const p = await seedActive();
    await deliver(
      refundEvent(p, "refund.processed", {
        amount: Math.floor(CERTIFICATE_PRICE_INR / 2),
      }),
      `evt_rfp_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment.status).toBe("COMPLETED");
    expect(s.certificate.status).toBe("ACTIVE");
  });

  it("an auto-refunded uncaptured authorization leaves the purchase open", async () => {
    const p = await seedPurchase();
    await deliver(
      refundEvent(p, "refund.processed", { captured: false }),
      `evt_rfa_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment.status).toBe("PENDING");
    expect(s.certificate.status).toBe("PENDING_PAYMENT");
    expect((await getOwnerCertificate(p.user.id, p.resultId)).state).toBe(
      "PENDING_PAYMENT"
    );
  });

  it("a refund.processed event whose refund entity is not processed changes nothing", async () => {
    const p = await seedActive();
    await deliver(
      refundEvent(p, "refund.processed", { status: "pending" }),
      `evt_rfx_${p.tag}`
    );
    expect((await state(p)).certificate.status).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// Admin revocation (service primitive; no public endpoint)
// ---------------------------------------------------------------------------

describe("admin revocation", () => {
  const makeUser = (role: "USER" | "ADMIN") =>
    db.user.create({
      data: {
        authId: randomUUID(),
        email: `${role.toLowerCase()}-${randomBytes(4).toString("hex")}@example.com`,
        role,
      },
    });

  it("rejects non-admins, including the certificate's owner", async () => {
    const p = await seedActive();
    const other = await makeUser("USER");

    for (const actor of [p.user.id, other.id]) {
      await expect(
        revokeCertificate(actor, p.certificateId, "trying")
      ).rejects.toMatchObject({ status: 403 });
    }
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("VERIFIED");
  });

  it("revokes immediately, idempotently, and never reactivates", async () => {
    const p = await seedActive();
    const admin = await makeUser("ADMIN");

    const revoked = await revokeCertificate(admin.id, p.certificateId, "Fraud review");
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedReason).toBe("ADMIN: Fraud review");
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("REVOKED");

    const again = await revokeCertificate(admin.id, p.certificateId, "Second reason");
    expect(again.revokedAt).toEqual(revoked.revokedAt);
    expect(again.revokedReason).toBe("ADMIN: Fraud review");

    expect((await fulfillCertificate(p.certificateId)).status).toBe("REVOKED");
    await deliver(captureEvent(p), `evt_cap_again_${p.tag}`);
    expect((await state(p)).certificate.status).toBe("REVOKED");
  });

  it("validates the target and the reason", async () => {
    const p = await seedActive();
    const admin = await makeUser("ADMIN");
    await expect(
      revokeCertificate(admin.id, "TF-2099-NOPE00", "x")
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      revokeCertificate(admin.id, p.certificateId, "  ")
    ).rejects.toMatchObject({
      status: 400,
    });
    expect((await state(p)).certificate.status).toBe("ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// Public verification
// ---------------------------------------------------------------------------

describe("public verification", () => {
  it("ACTIVE → verified, with public-safe fields only", async () => {
    const p = await seedActive();
    const v = await getCertificateVerification(p.certificateId);

    expect(v).toMatchObject({
      certificateId: p.certificateId,
      state: "VERIFIED",
      recipientName: "Pat Typist",
      wpm: 52,
      accuracy: 0.97,
      duration: 300,
      language: "ENGLISH",
      pdfUrl: publicUrlFor(p.certificateId),
    });
    expect(Object.keys(v!).sort()).toEqual(
      [
        "accuracy",
        "certificateId",
        "duration",
        "issuedAt",
        "language",
        "message",
        "pdfUrl",
        "recipientName",
        "state",
        "testType",
        "wpm",
      ].sort()
    );
    const s = await state(p);
    const serialized = JSON.stringify(v);
    for (const secret of [
      s.certificate.verificationHash,
      s.certificate.id,
      s.certificate.userId,
      s.certificate.resultId,
      s.payment.orderId,
      p.payId,
      p.user.email,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("PENDING_PAYMENT and PENDING_FULFILLMENT → not verified, no details", async () => {
    const unpaid = await seedPurchase();
    const pending = await seedPendingFulfillment();

    expect(await getCertificateVerification(unpaid.certificateId)).toEqual({
      certificateId: unpaid.certificateId,
      state: "PENDING",
      message: expect.stringMatching(/not been activated/),
    });
    expect(await getCertificateVerification(pending.certificateId)).toEqual({
      certificateId: pending.certificateId,
      state: "PROCESSING",
      message: expect.stringMatching(/being prepared/),
    });
  });

  it("REVOKED, EXPIRED and an elapsed expiresAt → not verified", async () => {
    const revoked = await seedActive();
    await deliver(refundEvent(revoked, "refund.processed"), `evt_rf_${revoked.tag}`);
    expect((await getCertificateVerification(revoked.certificateId))?.state).toBe(
      "REVOKED"
    );

    const expired = await seedActive();
    await db.certificate.update({
      where: { certificateId: expired.certificateId },
      data: { status: "EXPIRED" },
    });
    expect((await getCertificateVerification(expired.certificateId))?.state).toBe(
      "EXPIRED"
    );

    const lapsed = await seedActive();
    await db.certificate.update({
      where: { certificateId: lapsed.certificateId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getCertificateVerification(lapsed.certificateId))?.state).toBe(
      "EXPIRED"
    );
  });

  it("an ACTIVE row whose verification hash does not match is not verified", async () => {
    const p = await seedActive();
    await db.certificate.update({
      where: { certificateId: p.certificateId },
      data: { verificationHash: "0".repeat(64) },
    });
    expect((await getCertificateVerification(p.certificateId))?.state).toBe("INVALID");
  });

  it("the verification hash is stable across reads", async () => {
    const p = await seedActive();
    await getCertificateVerification(p.certificateId);
    await getCertificateVerification(p.certificateId);
    expect((await state(p)).certificate.verificationHash).toBe(
      p.certificate.verificationHash
    );
  });

  it("unknown and malformed IDs → not found", async () => {
    expect(await getCertificateVerification("TF-2099-ZZZZZZ")).toBeNull();
    expect(await getCertificateVerification("'; DROP TABLE x; --")).toBeNull();
  });
});

describe("/verify/[certificateId] page", () => {
  const renderPage = async (certificateId: string) =>
    renderToStaticMarkup(
      await VerifyCertificatePage({ params: Promise.resolve({ certificateId }) })
    );

  it("shows a verified certificate", async () => {
    const p = await seedActive();
    const html = await renderPage(p.certificateId);
    expect(html).toContain("Verified Certificate");
    expect(html).toContain("Pat Typist");
    expect(html).toContain(p.certificateId);
    expect(html).toContain(`/verify/${p.certificateId}`);
    expect(html).toContain("Download PDF");
  });

  it.each([
    ["unpaid", seedPurchase, "Not Activated"],
    ["pending fulfillment", seedPendingFulfillment, "Being Prepared"],
  ] as const)("shows %s as not verified", async (_label, seed, title) => {
    const p = await seed();
    const html = await renderPage(p.certificateId);
    expect(html).toContain("Not Verified");
    expect(html).toContain(title);
    expect(html).not.toContain("Verified Certificate");
    expect(html).not.toContain("Pat Typist");
  });

  it("shows a revoked certificate as revoked, not verified", async () => {
    const p = await seedActive();
    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);
    const html = await renderPage(p.certificateId);
    expect(html).toContain("Certificate Revoked");
    expect(html).not.toContain("Verified Certificate");
    expect(html).not.toContain("Download PDF");
  });

  it("404s for an unknown certificate", async () => {
    await expect(renderPage("TF-2099-ZZZZZZ")).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });

  it("the legacy /certificate/[id] page redirects to the canonical route", async () => {
    const p = await seedActive();
    await expect(
      LegacyCertificatePage({ params: Promise.resolve({ id: p.certificate.id }) })
    ).rejects.toMatchObject({
      digest: expect.stringContaining(`/verify/${p.certificateId}`),
    });
    await expect(
      LegacyCertificatePage({ params: Promise.resolve({ id: "not-a-uuid" }) })
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});

// ---------------------------------------------------------------------------
// Owner-facing state and retry endpoint
// ---------------------------------------------------------------------------

describe("owner certificate state", () => {
  it("follows the lifecycle and is hidden from other users", async () => {
    const p = await seedPurchase();
    expect(await getOwnerCertificate(p.user.id, p.resultId)).toEqual({
      state: "PENDING_PAYMENT",
      certificateId: p.certificateId,
    });
    expect((await getOwnerCertificate(randomUUID(), p.resultId)).state).toBe("NONE");

    certificateStorage.failNext = 1;
    await expect(deliver(captureEvent(p), `evt_cap_${p.tag}`)).rejects.toMatchObject(
      FULFILLMENT_FAILED
    );
    expect((await getOwnerCertificate(p.user.id, p.resultId)).state).toBe("PROCESSING");

    await fulfillCertificate(p.certificateId);
    expect((await getOwnerCertificate(p.user.id, p.resultId)).state).toBe("ACTIVE");
  });
});

describe("POST /api/certificate/fulfill", () => {
  const post = (body: unknown) =>
    fulfillRoute(
      new Request("http://localhost/api/certificate/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as never
    );
  const signIn = (id: string) =>
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id } as never);

  it("requires sign-in", async () => {
    const p = await seedPendingFulfillment();
    expect((await post({ certificateId: p.certificateId })).status).toBe(401);
  });

  it("hides another user's certificate", async () => {
    const p = await seedPendingFulfillment();
    signIn(randomUUID());
    expect((await post({ certificateId: p.certificateId })).status).toBe(404);
    expect((await state(p)).certificate.status).toBe("PENDING_FULFILLMENT");
  });

  it("refuses an unpaid certificate", async () => {
    const p = await seedPurchase();
    signIn(p.user.id);
    const res = await post({ certificateId: p.certificateId });
    expect(res.status).toBe(409);
    expect((await state(p)).certificate.status).toBe("PENDING_PAYMENT");
  });

  it("completes a paid certificate for its owner, idempotently", async () => {
    const p = await seedPendingFulfillment();
    signIn(p.user.id);

    const res = await post({ certificateId: p.certificateId });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ACTIVE" });

    const again = await post({ certificateId: p.certificateId });
    expect(await again.json()).toEqual({ status: "ACTIVE" });
    expect(certificateStorage.uploadsFor(p.certificateId)).toBe(2); // 1 failed + 1 stored
  });

  it("maps a storage failure to 503 and stays pending", async () => {
    const p = await seedPendingFulfillment();
    signIn(p.user.id);
    certificateStorage.failNext = 1;

    const res = await post({ certificateId: p.certificateId });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("FULFILLMENT_FAILED");
    expect((await state(p)).certificate.status).toBe("PENDING_FULFILLMENT");
  });

  it("does not reactivate a revoked certificate", async () => {
    const p = await seedPendingFulfillment();
    await deliver(refundEvent(p, "refund.processed"), `evt_rf_${p.tag}`);
    signIn(p.user.id);
    expect((await post({ certificateId: p.certificateId })).status).toBe(409);
    expect(
      await retryCertificateFulfillment(p.user.id, p.certificateId).catch((e) => e.status)
    ).toBe(409);
    expect((await state(p)).certificate.status).toBe("REVOKED");
  });
});
