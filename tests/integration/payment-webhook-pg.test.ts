/**
 * Razorpay payment webhooks against real Postgres: capture-only activation and
 * idempotency enforced by the unique payment_events.providerEventId.
 *
 * Payloads follow Razorpay's documented webhook shape (entity, account_id,
 * event, contains, payload.payment.entity{ id, order_id, amount, currency,
 * status }, created_at). Deliveries are HMAC-signed with the test secret.
 *
 * Activation = capture, then PDF fulfillment after commit; certificate
 * storage is the in-memory fake (see certificate-lifecycle-pg.test.ts for the
 * fulfillment, refund and verification lifecycle).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import { processRazorpayWebhook } from "@/server/services/payment.service";
import { POST as webhookRoute } from "@/app/api/payment/webhook/route";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeSupabaseServer } = await import("../setup/fakeCertificateStorage");
  return fakeSupabaseServer;
});
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));

// Test-only placeholders for getServerEnv(), used only when the variable is
// not already provided (CI sets real test values). Restored after the file.
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

const secret = () => process.env.RAZORPAY_WEBHOOK_SECRET as string;

/** A PENDING certificate purchase for a trusted (or untrusted) result. */
async function seedPurchase(
  opts: { scoringSource?: "SERVER_RECONSTRUCTED" | "CLIENT_COUNTS" } = {}
) {
  const tag = randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: { authId: randomUUID(), email: `pay-${tag}@example.com` },
  });
  const passage = await db.passage.create({
    data: { content: "payment webhook passage", wordCount: 3, charCount: 23 },
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
      integrityToken: `pay-${tag}`,
      startedAt: new Date(Date.now() - 300_000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      shareId: `pay${tag}`,
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
      scoringSource: opts.scoringSource ?? "SERVER_RECONSTRUCTED",
    },
  });
  const certificate = await db.certificate.create({
    data: {
      certificateId: `TF-PAY-${tag}`,
      verificationHash: "h".repeat(64),
      userId: user.id,
      resultId: result.id,
      status: "PENDING_PAYMENT",
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
      orderId: `order_${tag}`,
      amount: CERTIFICATE_PRICE_INR,
      currency: "INR",
      idempotencyKey: `idem_${tag}`,
      status: "PENDING",
    },
  });
  return {
    tag,
    orderId: payment.orderId,
    paymentRowId: payment.id,
    certificateRowId: certificate.id,
  };
}

function delivery(
  orderId: string,
  event: string,
  entity: { id: string; status: string; amount?: number }
) {
  const payload = {
    entity: "event",
    account_id: "acc_TEST000000001",
    event,
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: entity.id,
          entity: "payment",
          order_id: orderId,
          amount: entity.amount ?? CERTIFICATE_PRICE_INR,
          currency: "INR",
          status: entity.status,
        },
      },
    },
    created_at: 1790200000,
  };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret()).update(raw).digest("hex");
  return { payload, raw, signature };
}

const deliver = (d: ReturnType<typeof delivery>, eventId?: string | null) =>
  processRazorpayWebhook(d.payload, d.signature, d.raw, eventId);

async function state(p: { paymentRowId: string; certificateRowId: string }) {
  const [payment, certificate, events] = await Promise.all([
    db.payment.findUniqueOrThrow({ where: { id: p.paymentRowId } }),
    db.certificate.findUniqueOrThrow({ where: { id: p.certificateRowId } }),
    db.paymentEvent.findMany({ where: { paymentId: p.paymentRowId } }),
  ]);
  return { payment: payment.status, certificate: certificate.status, events };
}

describe("payment webhook — capture-only activation", () => {
  it("authorized-only payment does NOT complete the payment or activate the certificate", async () => {
    const p = await seedPurchase();
    await deliver(
      delivery(p.orderId, "payment.authorized", { id: "pay_a", status: "authorized" }),
      `evt_auth_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment).toBe("PENDING");
    expect(s.certificate).toBe("PENDING_PAYMENT");
    expect(s.events.map((e) => e.eventType)).toEqual(["payment.authorized"]);
  });

  it("captured payment completes the payment and activates the certificate", async () => {
    const p = await seedPurchase();
    await deliver(
      delivery(p.orderId, "payment.authorized", { id: "pay_c", status: "authorized" }),
      `evt_a_${p.tag}`
    );
    await deliver(
      delivery(p.orderId, "payment.captured", { id: "pay_c", status: "captured" }),
      `evt_c_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment).toBe("COMPLETED");
    expect(s.certificate).toBe("ACTIVE");
  });

  it("does not activate on a payment.captured event whose entity is not captured", async () => {
    const p = await seedPurchase();
    await deliver(
      delivery(p.orderId, "payment.captured", { id: "pay_x", status: "authorized" }),
      `evt_x_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment).toBe("PENDING");
    expect(s.certificate).toBe("PENDING_PAYMENT");
  });

  it("failed payment does not activate; a later captured retry on the same order does", async () => {
    const p = await seedPurchase();
    await deliver(
      delivery(p.orderId, "payment.failed", { id: "pay_f1", status: "failed" }),
      `evt_f_${p.tag}`
    );
    let s = await state(p);
    expect(s.payment).toBe("FAILED");
    expect(s.certificate).toBe("PENDING_PAYMENT");

    await deliver(
      delivery(p.orderId, "payment.captured", { id: "pay_f2", status: "captured" }),
      `evt_r_${p.tag}`
    );
    s = await state(p);
    expect(s.payment).toBe("COMPLETED");
    expect(s.certificate).toBe("ACTIVE");
  });

  it("never activates a certificate whose result is not trusted, even when paid", async () => {
    const p = await seedPurchase({ scoringSource: "CLIENT_COUNTS" });
    await deliver(
      delivery(p.orderId, "payment.captured", { id: "pay_u", status: "captured" }),
      `evt_u_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment).toBe("COMPLETED");
    expect(s.certificate).toBe("PENDING_PAYMENT");
  });

  it("rejects a captured amount that does not match the order", async () => {
    const p = await seedPurchase();
    await expect(
      deliver(
        delivery(p.orderId, "payment.captured", {
          id: "pay_m",
          status: "captured",
          amount: 1,
        }),
        `evt_m_${p.tag}`
      )
    ).rejects.toThrow("PAYMENT_AMOUNT_MISMATCH");

    const s = await state(p);
    expect(s.payment).toBe("PENDING");
    expect(s.events).toHaveLength(0); // the whole transaction rolled back
  });
});

describe("payment webhook — idempotency", () => {
  it("processes the same event delivered twice sequentially exactly once", async () => {
    const p = await seedPurchase();
    const d = delivery(p.orderId, "payment.captured", {
      id: "pay_s",
      status: "captured",
    });
    await deliver(d, `evt_s_${p.tag}`);
    await deliver(d, `evt_s_${p.tag}`);

    const s = await state(p);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.providerEventId).toBe(`evt:evt_s_${p.tag}`);
    expect(s.payment).toBe("COMPLETED");
    expect(s.certificate).toBe("ACTIVE");
  });

  it("treats a concurrent duplicate delivery as a duplicate, not an error", async () => {
    const p = await seedPurchase();
    const d = delivery(p.orderId, "payment.captured", {
      id: "pay_cc",
      status: "captured",
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => deliver(d, `evt_cc_${p.tag}`))
    );

    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    const s = await state(p);
    expect(s.events).toHaveLength(1);
    expect(s.payment).toBe("COMPLETED");
    expect(s.certificate).toBe("ACTIVE");
  });

  it("dedupes byte-identical redeliveries when the event-id header is missing", async () => {
    const p = await seedPurchase();
    const d = delivery(p.orderId, "payment.authorized", {
      id: "pay_nh",
      status: "authorized",
    });
    await deliver(d, null);
    await deliver(d, undefined);

    const s = await state(p);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.providerEventId).toMatch(/^body:[0-9a-f]{64}$/);
  });

  it("does not collapse distinct events for the same payment", async () => {
    const p = await seedPurchase();
    await deliver(
      delivery(p.orderId, "payment.authorized", { id: "pay_d", status: "authorized" }),
      `evt_d1_${p.tag}`
    );
    await deliver(
      delivery(p.orderId, "payment.captured", { id: "pay_d", status: "captured" }),
      `evt_d2_${p.tag}`
    );
    // Without the header, distinct bodies also stay distinct.
    await deliver(
      delivery(p.orderId, "refund.created", { id: "pay_d", status: "captured" }),
      null
    );

    const s = await state(p);
    expect(s.events.map((e) => e.eventType).sort()).toEqual([
      "payment.authorized",
      "payment.captured",
      "refund.created",
    ]);
    // refund.created is only a request: recorded, but nothing is refunded yet.
    expect(s.payment).toBe("COMPLETED");
  });

  it("a replayed signed body under a new event id cannot re-transition state", async () => {
    const p = await seedPurchase();
    const d = delivery(p.orderId, "payment.captured", {
      id: "pay_rp",
      status: "captured",
    });
    await deliver(d, `evt_rp1_${p.tag}`);
    const before = await db.payment.findUniqueOrThrow({ where: { id: p.paymentRowId } });

    await deliver(d, `evt_rp2_${p.tag}`);

    const after = await db.payment.findUniqueOrThrow({ where: { id: p.paymentRowId } });
    expect(after.status).toBe("COMPLETED");
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect((await state(p)).certificate).toBe("ACTIVE");
  });

  it("route passes x-razorpay-event-id through as the idempotency key", async () => {
    const p = await seedPurchase();
    const d = delivery(p.orderId, "payment.authorized", {
      id: "pay_rt",
      status: "authorized",
    });
    const req = new Request("http://localhost/api/payment/webhook", {
      method: "POST",
      headers: {
        "x-razorpay-signature": d.signature,
        "x-razorpay-event-id": `evt_rt_${p.tag}`,
      },
      body: d.raw,
    });

    const res = await webhookRoute(req as never);

    expect(res.status).toBe(200);
    const s = await state(p);
    expect(s.events.map((e) => e.providerEventId)).toEqual([`evt:evt_rt_${p.tag}`]);
  });
});
