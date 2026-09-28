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
import {
  processRazorpayWebhook,
  webhookAnomalyKey,
} from "@/server/services/payment.service";
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
  entity: { id: string; status: string; amount?: number; currency?: string }
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
          currency: entity.currency ?? "INR",
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

  it("records a captured amount that does not match the order as an anomaly, never applied", async () => {
    const p = await seedPurchase();
    await deliver(
      delivery(p.orderId, "payment.captured", {
        id: `pay_m_${p.tag}`,
        status: "captured",
        amount: 1,
      }),
      `evt_m_${p.tag}`
    );

    const s = await state(p);
    expect(s.payment).toBe("PENDING");
    expect(s.certificate).toBe("PENDING_PAYMENT");
    expect(s.events.map((e) => e.providerEventId).sort()).toEqual([
      `evt:evt_m_${p.tag}`,
      webhookAnomalyKey("amount_mismatch", `pay_m_${p.tag}`),
    ]);
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

// ---------------------------------------------------------------------------
// Route: signature checks and response policy (Phase 5C-7)
// ---------------------------------------------------------------------------

describe("payment webhook route — signature and response policy", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    webhookRoute(
      new Request("http://localhost/api/payment/webhook", {
        method: "POST",
        headers,
        body,
      }) as never
    );
  const viaRoute = (d: ReturnType<typeof delivery>, eventId: string) =>
    post(d.raw, { "x-razorpay-signature": d.signature, "x-razorpay-event-id": eventId });
  const code = async (res: Response) =>
    ((await res.json()) as { error?: { code?: string } }).error?.code;

  /** Everything the logger writes while `fn` runs. */
  async function captureLogs<T>(fn: () => Promise<T>): Promise<[T, string]> {
    const lines: string[] = [];
    const keep = (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    };
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation(keep),
      vi.spyOn(process.stderr, "write").mockImplementation(keep),
      ...(["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        })
      ),
    ];
    try {
      return [await fn(), lines.join("\n")];
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  }

  const capture = (p: { orderId: string; tag: string }) =>
    delivery(p.orderId, "payment.captured", { id: `pay_r_${p.tag}`, status: "captured" });

  it.each([
    ["no signature header", undefined],
    ["an empty signature header", ""],
  ])("401 with %s, before anything is written", async (_name, signature) => {
    const p = await seedPurchase();
    const d = capture(p);
    const headers: Record<string, string> = { "x-razorpay-event-id": `evt_ns_${p.tag}` };
    if (signature !== undefined) headers["x-razorpay-signature"] = signature;

    const res = await post(d.raw, headers);

    expect(res.status).toBe(401);
    expect(await code(res)).toBe("UNAUTHORIZED");
    expect(await state(p)).toMatchObject({ payment: "PENDING", events: [] });
  });

  it("401 for malformed signatures, without throwing or writing anything", async () => {
    const p = await seedPurchase();
    const d = capture(p);
    for (const signature of [
      "abc",
      "z".repeat(64),
      d.signature.toUpperCase(),
      `${d.signature}00`,
      d.signature.slice(0, 63),
      ` ${d.signature.slice(1)}`,
    ]) {
      const res = await post(d.raw, {
        "x-razorpay-signature": signature,
        "x-razorpay-event-id": `evt_mf_${p.tag}`,
      });
      expect(res.status).toBe(401);
      expect(await code(res)).toBe("INVALID_PAYMENT_SIGNATURE");
    }
    expect(await state(p)).toMatchObject({ payment: "PENDING", events: [] });
  });

  it("401 for a wrong signature, logged with a reason but never the body, signature or secret", async () => {
    const p = await seedPurchase();
    const d = capture(p);
    const forged = createHmac("sha256", "not-the-webhook-secret")
      .update(d.raw)
      .digest("hex");

    const [res, logs] = await captureLogs(() =>
      post(d.raw, {
        "x-razorpay-signature": forged,
        "x-razorpay-event-id": `evt_f_${p.tag}`,
      })
    );

    expect(res.status).toBe(401);
    expect(await code(res)).toBe("INVALID_PAYMENT_SIGNATURE");
    expect(await state(p)).toMatchObject({ payment: "PENDING", events: [] });
    expect(logs).toContain("invalid_signature");
    expect(logs).toContain(`evt_f_${p.tag}`);
    for (const secretValue of [forged, d.signature, d.raw, p.orderId, secret()]) {
      expect(logs).not.toContain(secretValue);
    }
  });

  it("checks the signature before parsing: unsigned bad JSON is 401, signed bad JSON is 400", async () => {
    const raw = "{not json";
    const unsigned = await post(raw, { "x-razorpay-signature": "0".repeat(64) });
    expect(unsigned.status).toBe(401);

    const signed = await post(raw, {
      "x-razorpay-signature": createHmac("sha256", secret()).update(raw).digest("hex"),
    });
    expect(signed.status).toBe(400);
    expect(await code(signed)).toBe("BAD_REQUEST");
  });

  it("200 for a valid capture, which completes the payment and activates the certificate", async () => {
    const p = await seedPurchase();
    const res = await viaRoute(capture(p), `evt_ok_${p.tag}`);

    expect(res.status).toBe(200);
    expect(await state(p)).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
  });

  it("a duplicate delivery, sequential or concurrent, is acknowledged and recorded once", async () => {
    const p = await seedPurchase();
    const d = capture(p);
    const eventId = `evt_dup_${p.tag}`;

    const statuses = [
      (await viaRoute(d, eventId)).status,
      (await viaRoute(d, eventId)).status,
      ...(await Promise.all([viaRoute(d, eventId), viaRoute(d, eventId)])).map(
        (r) => r.status
      ),
    ];

    expect(statuses).toEqual([200, 200, 200, 200]);
    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
    expect(s.events.map((e) => e.providerEventId)).toEqual([`evt:${eventId}`]);
  });

  it("200 for an order that is not ours, with nothing recorded", async () => {
    const tag = randomBytes(4).toString("hex");
    const d = delivery(`order_elsewhere_${tag}`, "payment.captured", {
      id: `pay_x_${tag}`,
      status: "captured",
    });

    const [res, logs] = await captureLogs(() => viaRoute(d, `evt_x_${tag}`));

    expect(res.status).toBe(200);
    expect(
      await db.paymentEvent.count({ where: { providerEventId: `evt:evt_x_${tag}` } })
    ).toBe(0);
    expect(logs).toContain("unknown order");
  });

  it.each([
    ["an amount", "amount", { amount: 1 }],
    ["a currency", "currency", { currency: "USD" }],
  ] as const)(
    "%s mismatch is acknowledged (200) and recorded once as an anomaly; nothing is applied",
    async (_name, kind, over) => {
      const p = await seedPurchase();
      const rpId = `pay_mm_${p.tag}`;
      const d = delivery(p.orderId, "payment.captured", {
        id: rpId,
        status: "captured",
        ...over,
      });
      const anomalyKey = webhookAnomalyKey(`${kind}_mismatch`, rpId);

      const first = await viaRoute(d, `evt_mm1_${p.tag}`);
      const redelivered = await viaRoute(d, `evt_mm1_${p.tag}`);
      const replayed = await viaRoute(d, `evt_mm2_${p.tag}`);

      expect([first.status, redelivered.status, replayed.status]).toEqual([
        200, 200, 200,
      ]);
      const s = await state(p);
      expect(s).toMatchObject({ payment: "PENDING", certificate: "PENDING_PAYMENT" });
      expect(s.events.map((e) => e.providerEventId).sort()).toEqual(
        [`evt:evt_mm1_${p.tag}`, `evt:evt_mm2_${p.tag}`, anomalyKey].sort()
      );

      const anomaly = s.events.find((e) => e.providerEventId === anomalyKey);
      expect(anomaly?.eventType).toBe("webhook.anomaly");
      expect(anomaly?.payload).toEqual({
        source: "webhook",
        kind: `${kind}_mismatch`,
        eventType: "payment.captured",
        orderId: p.orderId,
        razorpayPaymentId: rpId,
        expectedAmount: CERTIFICATE_PRICE_INR,
        expectedCurrency: "INR",
        receivedAmount: "amount" in over ? over.amount : CERTIFICATE_PRICE_INR,
        receivedCurrency: "currency" in over ? over.currency : "INR",
      });
    }
  );

  it("a mismatch on an already-completed payment is neither applied nor recorded as an anomaly", async () => {
    const p = await seedPurchase();
    expect((await viaRoute(capture(p), `evt_ok2_${p.tag}`)).status).toBe(200);

    const late = delivery(p.orderId, "payment.captured", {
      id: `pay_late_${p.tag}`,
      status: "captured",
      amount: 1,
    });
    expect((await viaRoute(late, `evt_late_${p.tag}`)).status).toBe(200);

    const s = await state(p);
    expect(s).toMatchObject({ payment: "COMPLETED", certificate: "ACTIVE" });
    expect(s.events.some((e) => e.eventType === "webhook.anomaly")).toBe(false);
  });
});
