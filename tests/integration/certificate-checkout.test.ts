/**
 * Certificate claim + checkout path (Phase 4D step 3) against real Postgres:
 * issuance and order creation through the real routes. Razorpay order creation
 * is mocked; nothing calls the real provider.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { createRazorpayOrder } from "@/server/services/razorpay.service";
import { processRazorpayWebhook } from "@/server/services/payment.service";
import { POST as issueRoute } from "@/app/api/certificate/issue/route";
import { POST as orderRoute } from "@/app/api/payment/create-order/route";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";

// Certificate PDF storage (used by post-capture fulfillment) is the in-memory fake.
vi.mock("@/lib/supabase/server", async () => {
  const { fakeSupabaseServer } = await import("../setup/fakeCertificateStorage");
  return fakeSupabaseServer;
});
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));
vi.mock("@/server/services/razorpay.service", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("@/server/services/razorpay.service");
  return {
    ...actual,
    createRazorpayOrder: vi.fn(async (amount: number, receipt: string) => ({
      orderId: `order_${randomBytes(6).toString("hex")}`,
      amount,
      currency: "INR",
      receipt,
    })),
  };
});

// Test-only placeholders (server + client env), only when not already set.
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
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-anon-key",
  NEXT_PUBLIC_RAZORPAY_KEY_ID: "rzp_test_placeholder",
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
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
  vi.mocked(createRazorpayOrder).mockClear();
});

const asUser = (user: { id: string } | null) =>
  vi.mocked(getAuthenticatedUser).mockResolvedValue(user as never);
const post = (route: (req: never) => Promise<Response>, body: unknown) =>
  route(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );

async function seedUser() {
  return db.user.create({
    data: {
      authId: randomUUID(),
      email: `chk-${randomBytes(4).toString("hex")}@example.com`,
    },
  });
}

/** A completed result owned by `userId`; eligible unless overridden. */
async function seedResult(
  userId: string,
  o: {
    trustTier?: "FREE" | "CERTIFICATE";
    netWpm?: number;
    scoringSource?: "CLIENT_COUNTS";
  } = {}
) {
  const tag = randomBytes(4).toString("hex");
  const passage = await db.passage.create({
    data: {
      content: "checkout passage",
      wordCount: 2,
      charCount: 16,
      mode: "CERTIFICATE",
    },
  });
  const session = await db.testSession.create({
    data: {
      userId,
      mode: "TIMED",
      language: "ENGLISH",
      duration: 300,
      trustTier: o.trustTier ?? "CERTIFICATE",
      status: "COMPLETED",
      passageId: passage.id,
      integrityToken: `chk-${tag}`,
      startedAt: new Date(Date.now() - 300_000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const netWpm = o.netWpm ?? 50;
  return db.testResult.create({
    data: {
      sessionId: session.id,
      userId,
      shareId: `chk${tag}`,
      wpm: netWpm,
      rawWpm: netWpm,
      netWpm,
      accuracy: 0.97,
      correctChars: 1250,
      incorrectChars: 0,
      totalChars: 1250,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: 300_000,
      duration: 300,
      integrityStatus: "VERIFIED",
      scoringSource: o.scoringSource ?? "SERVER_RECONSTRUCTED",
    },
  });
}

async function issue(userId: string, resultId: string) {
  asUser({ id: userId });
  const res = await post(issueRoute, { resultId });
  return { status: res.status, body: await res.json() };
}

async function order(userId: string | null, certificateId: string) {
  asUser(userId ? { id: userId } : null);
  const res = await post(orderRoute, { certificateId });
  return { status: res.status, body: await res.json() };
}

const noInternals = (body: unknown) =>
  expect(JSON.stringify(body)).not.toMatch(
    /prisma|P20\d\d|unique constraint|invocation|razorpay api/i
  );

describe("certificate issuance", () => {
  it("rejects a guest", async () => {
    const owner = await seedUser();
    const result = await seedResult(owner.id);
    asUser(null);
    const res = await post(issueRoute, { resultId: result.id });

    expect(res.status).toBe(401);
    expect(await db.certificate.count({ where: { resultId: result.id } })).toBe(0);
  });

  it("rejects a non-owner without revealing the result's eligibility details", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const result = await seedResult(owner.id, { netWpm: 5 });
    const { status, body } = await issue(other.id, result.id);

    expect(status).toBe(403);
    expect(JSON.stringify(body)).not.toMatch(/WPM|Accuracy|duration/);
    expect(await db.certificate.count({ where: { resultId: result.id } })).toBe(0);
  });

  it.each([
    ["below thresholds", { netWpm: 10 }],
    ["FREE tier", { trustTier: "FREE" as const }],
    ["not server-reconstructed", { scoringSource: "CLIENT_COUNTS" as const }],
  ])(
    "rejects an ineligible result (%s) with 422, ignoring any client flag",
    async (_l, o) => {
      const owner = await seedUser();
      const result = await seedResult(owner.id, o);
      asUser({ id: owner.id });
      const res = await post(issueRoute, {
        resultId: result.id,
        isCertificateEligible: true,
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("NOT_ELIGIBLE");
      expect(await db.certificate.count({ where: { resultId: result.id } })).toBe(0);
    }
  );

  it("issues a PENDING_PAYMENT certificate to the eligible owner", async () => {
    const owner = await seedUser();
    const result = await seedResult(owner.id);
    const { status, body } = await issue(owner.id, result.id);

    expect(status).toBe(200);
    const cert = await db.certificate.findUniqueOrThrow({
      where: { resultId: result.id },
    });
    expect(body.certificateId).toBe(cert.certificateId);
    expect(cert.status).toBe("PENDING_PAYMENT");
  });

  it("is idempotent for sequential duplicates", async () => {
    const owner = await seedUser();
    const result = await seedResult(owner.id);
    const a = await issue(owner.id, result.id);
    const b = await issue(owner.id, result.id);

    expect(b.status).toBe(200);
    expect(b.body.certificateId).toBe(a.body.certificateId);
    expect(await db.certificate.count({ where: { resultId: result.id } })).toBe(1);
  });

  it("is idempotent for concurrent duplicates", async () => {
    const owner = await seedUser();
    const result = await seedResult(owner.id);
    asUser({ id: owner.id });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => post(issueRoute, { resultId: result.id }))
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new Set(bodies.map((b) => b.certificateId)).size).toBe(1);
    expect(await db.certificate.count({ where: { resultId: result.id } })).toBe(1);
  });

  it("returns safe errors for bad input and unknown results", async () => {
    const owner = await seedUser();
    asUser({ id: owner.id });

    const bad = await post(issueRoute, { resultId: "not-a-uuid" });
    expect(bad.status).toBe(400);
    noInternals(await bad.json());

    const missing = await post(issueRoute, { resultId: randomUUID() });
    expect(missing.status).toBe(404);
    noInternals(await missing.json());
  });

  it("never exposes a raw database error", async () => {
    const owner = await seedUser();
    const result = await seedResult(owner.id);
    // Prisma delegates hand out a fresh method per access, so swap and
    // restore explicitly rather than with vi.spyOn.
    const delegate = db.certificate as unknown as Record<string, unknown>;
    const original = delegate.create;
    delegate.create = () =>
      Promise.reject(
        Object.assign(
          new Error("Invalid `prisma.certificate.create()` invocation: secret internals"),
          { code: "P2010" }
        )
      );
    vi.spyOn(console, "error").mockImplementation(() => {});
    let response: Awaited<ReturnType<typeof issue>>;
    try {
      response = await issue(owner.id, result.id);
    } finally {
      delegate.create = original;
    }

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe("Failed to issue certificate");
    noInternals(response.body);
  });
});

describe("certificate order creation", () => {
  async function pendingCertificate() {
    const owner = await seedUser();
    const result = await seedResult(owner.id);
    const { body } = await issue(owner.id, result.id);
    const cert = await db.certificate.findUniqueOrThrow({
      where: { certificateId: body.certificateId },
    });
    return { owner, cert };
  }
  const paymentsFor = (certificateRowId: string) =>
    db.payment.findMany({ where: { certificateId: certificateRowId } });

  it("rejects guests and non-owners without calling Razorpay", async () => {
    const { cert } = await pendingCertificate();
    const other = await seedUser();

    expect((await order(null, cert.certificateId)).status).toBe(401);
    const forbidden = await order(other.id, cert.certificateId);
    expect(forbidden.status).toBe(403);
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    expect(await paymentsFor(cert.id)).toHaveLength(0);
  });

  it("creates one PENDING payment priced from CERTIFICATE_PRICE_INR", async () => {
    const { owner, cert } = await pendingCertificate();
    const { status, body } = await order(owner.id, cert.certificateId);

    expect(status).toBe(200);
    expect(body.amount).toBe(CERTIFICATE_PRICE_INR);
    expect(body.keyId).toBeTruthy();
    expect(createRazorpayOrder).toHaveBeenCalledWith(
      CERTIFICATE_PRICE_INR,
      `cert_${cert.certificateId}`
    );
    const payments = await paymentsFor(cert.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: "PENDING",
      amount: CERTIFICATE_PRICE_INR,
      orderId: body.orderId,
    });
  });

  it("reuses the existing order while the payment is PENDING", async () => {
    const { owner, cert } = await pendingCertificate();
    const first = await order(owner.id, cert.certificateId);
    const second = await order(owner.id, cert.certificateId);

    expect(second.body.orderId).toBe(first.body.orderId);
    expect(createRazorpayOrder).toHaveBeenCalledTimes(1);
    expect(await paymentsFor(cert.id)).toHaveLength(1);
  });

  it("retries a FAILED payment on the same row and the same Razorpay order", async () => {
    const { owner, cert } = await pendingCertificate();
    const first = await order(owner.id, cert.certificateId);
    const [row] = await paymentsFor(cert.id);
    await db.payment.update({
      where: { id: row!.id },
      data: { status: "FAILED", paymentId: "pay_failed" },
    });

    const retry = await order(owner.id, cert.certificateId);

    expect(retry.status).toBe(200);
    expect(retry.body.orderId).toBe(first.body.orderId);
    expect(createRazorpayOrder).toHaveBeenCalledTimes(1);
    const payments = await paymentsFor(cert.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      id: row!.id,
      status: "PENDING",
      paymentId: null,
    });
  });

  it("handles concurrent retries of a FAILED payment without a duplicate row", async () => {
    const { owner, cert } = await pendingCertificate();
    const first = await order(owner.id, cert.certificateId);
    const [row] = await paymentsFor(cert.id);
    await db.payment.update({ where: { id: row!.id }, data: { status: "FAILED" } });

    asUser({ id: owner.id });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        post(orderRoute, { certificateId: cert.certificateId })
      )
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(new Set(bodies.map((b) => b.orderId))).toEqual(new Set([first.body.orderId]));
    const payments = await paymentsFor(cert.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe("PENDING");
  });

  it("handles concurrent first orders with exactly one payment row", async () => {
    const { owner, cert } = await pendingCertificate();
    asUser({ id: owner.id });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        post(orderRoute, { certificateId: cert.certificateId })
      )
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    const payments = await paymentsFor(cert.id);
    expect(payments).toHaveLength(1);
    // Every caller is handed the one persisted order.
    expect(new Set(bodies.map((b) => b.orderId))).toEqual(
      new Set([payments[0]!.orderId])
    );
  });

  it("never starts another order once the certificate is paid", async () => {
    const { owner, cert } = await pendingCertificate();
    await order(owner.id, cert.certificateId);
    const [row] = await paymentsFor(cert.id);
    await db.payment.update({ where: { id: row!.id }, data: { status: "COMPLETED" } });
    vi.mocked(createRazorpayOrder).mockClear();

    const { status, body } = await order(owner.id, cert.certificateId);

    expect(status).toBe(409);
    expect(body.error.code).toBe("ALREADY_PAID");
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    expect(await paymentsFor(cert.id)).toHaveLength(1);
  });

  it("returns a generic error when Razorpay fails, with no row created", async () => {
    const { owner, cert } = await pendingCertificate();
    vi.mocked(createRazorpayOrder).mockRejectedValueOnce(
      new Error("Razorpay API error: BAD_REQUEST_ERROR key_secret invalid")
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await order(owner.id, cert.certificateId);

    expect(status).toBe(500);
    expect(body.error.message).toBe("Failed to create order");
    noInternals(body);
    expect(JSON.stringify(body)).not.toContain("key_secret");
    expect(await paymentsFor(cert.id)).toHaveLength(0);
  });

  it("a capture on the retried (same) order still completes the payment", async () => {
    const { owner, cert } = await pendingCertificate();
    const first = await order(owner.id, cert.certificateId);
    const [row] = await paymentsFor(cert.id);
    await db.payment.update({ where: { id: row!.id }, data: { status: "FAILED" } });
    await order(owner.id, cert.certificateId);

    const payload = {
      entity: "event",
      account_id: "acc_TEST000000001",
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: "pay_retry_ok",
            order_id: first.body.orderId,
            amount: CERTIFICATE_PRICE_INR,
            currency: "INR",
            status: "captured",
          },
        },
      },
      created_at: 1790200000,
    };
    const raw = JSON.stringify(payload);
    const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET as string)
      .update(raw)
      .digest("hex");
    await processRazorpayWebhook(
      payload,
      signature,
      raw,
      `evt_retry_${cert.certificateId}`
    );

    const [after] = await paymentsFor(cert.id);
    expect(after!.status).toBe("COMPLETED");
  });
});
