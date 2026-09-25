/**
 * Regression: POST /api/payment/create-order must return the Razorpay key id
 * from the validated server env, never from NEXT_PUBLIC_* runtime variables.
 *
 * On a Vercel Preview the Razorpay order and the PENDING payment row were
 * created, then the route called getClientEnv(), whose NEXT_PUBLIC_* values
 * were missing/empty at server runtime, and answered 500. This file runs with
 * no usable NEXT_PUBLIC_* values at all, in its own module registry so no other
 * test can warm getClientEnv()'s cache. Real Postgres; Razorpay is mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting, getServerEnv } from "@/lib/env";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { createRazorpayOrder } from "@/server/services/razorpay.service";
import { POST as issueRoute } from "@/app/api/certificate/issue/route";
import { POST as orderRoute } from "@/app/api/payment/create-order/route";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";

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

/** Test-only server key id, distinct from any NEXT_PUBLIC_* value. */
const SERVER_KEY_ID = "rzp_test_server_env_only";
const CLIENT_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_RAZORPAY_KEY_ID",
] as const;

beforeAll(() => {
  vi.stubEnv("RAZORPAY_KEY_ID", SERVER_KEY_ID);
  __clearServerEnvForTesting();
});
afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});
beforeEach(() => {
  // Missing at server runtime (the default for this file).
  for (const key of CLIENT_ENV_KEYS) vi.stubEnv(key, undefined);
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
  vi.mocked(createRazorpayOrder).mockClear();
});

const post = async (
  route: (req: never) => Promise<Response>,
  userId: string,
  body: unknown
) => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: userId } as never);
  const res = await route(
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  );
  return { status: res.status, body: await res.json() };
};

/** An eligible result's PENDING_PAYMENT certificate, issued through the route. */
async function pendingCertificate() {
  const tag = randomBytes(4).toString("hex");
  const owner = await db.user.create({
    data: { authId: randomUUID(), email: `order-env-${tag}@example.com` },
  });
  const passage = await db.passage.create({
    data: {
      content: "order env passage",
      wordCount: 3,
      charCount: 17,
      mode: "CERTIFICATE",
    },
  });
  const session = await db.testSession.create({
    data: {
      userId: owner.id,
      mode: "TIMED",
      language: "ENGLISH",
      duration: 300,
      trustTier: "CERTIFICATE",
      status: "COMPLETED",
      passageId: passage.id,
      integrityToken: `order-env-${tag}`,
      startedAt: new Date(Date.now() - 300_000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: owner.id,
      shareId: `oenv${tag}`,
      wpm: 50,
      rawWpm: 50,
      netWpm: 50,
      accuracy: 0.97,
      correctChars: 1250,
      incorrectChars: 0,
      totalChars: 1250,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: 300_000,
      duration: 300,
      integrityStatus: "VERIFIED",
      scoringSource: "SERVER_RECONSTRUCTED",
    },
  });
  const issued = await post(issueRoute, owner.id, { resultId: result.id });
  expect(issued.status).toBe(200);
  const cert = await db.certificate.findUniqueOrThrow({
    where: { certificateId: issued.body.certificateId },
  });
  return { owner, cert };
}

describe("create-order without NEXT_PUBLIC_* at server runtime", () => {
  it("returns the server env Razorpay key id with the new order", async () => {
    expect(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID).toBeUndefined();
    const { owner, cert } = await pendingCertificate();

    const { status, body } = await post(orderRoute, owner.id, {
      certificateId: cert.certificateId,
    });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["amount", "currency", "keyId", "orderId"]);
    expect(body.keyId).toBe(SERVER_KEY_ID);
    expect(body.keyId).toBe(getServerEnv().RAZORPAY_KEY_ID);
    expect(body.amount).toBe(CERTIFICATE_PRICE_INR);
    expect(createRazorpayOrder).toHaveBeenCalledTimes(1);
    const payments = await db.payment.findMany({ where: { certificateId: cert.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "PENDING", orderId: body.orderId });
  });

  it("reuses an existing PENDING order with 200 — no new Razorpay order or row", async () => {
    const { owner, cert } = await pendingCertificate();
    const first = await post(orderRoute, owner.id, { certificateId: cert.certificateId });
    expect(first.status).toBe(200);
    vi.mocked(createRazorpayOrder).mockClear();

    const second = await post(orderRoute, owner.id, {
      certificateId: cert.certificateId,
    });

    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      orderId: first.body.orderId,
      amount: CERTIFICATE_PRICE_INR,
      currency: "INR",
      keyId: SERVER_KEY_ID,
    });
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    const payments = await db.payment.findMany({ where: { certificateId: cert.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "PENDING", orderId: first.body.orderId });
  });

  it("succeeds when NEXT_PUBLIC_* are empty strings (as seen on Vercel)", async () => {
    for (const key of CLIENT_ENV_KEYS) vi.stubEnv(key, "");
    const { owner, cert } = await pendingCertificate();

    const { status, body } = await post(orderRoute, owner.id, {
      certificateId: cert.certificateId,
    });

    expect(status).toBe(200);
    expect(body.keyId).toBe(SERVER_KEY_ID);
  });

  it("never exposes server secrets in the response", async () => {
    const { owner, cert } = await pendingCertificate();
    const { status, body } = await post(orderRoute, owner.id, {
      certificateId: cert.certificateId,
    });

    expect(status).toBe(200);
    const env = getServerEnv();
    const text = JSON.stringify(body);
    for (const secret of [
      env.RAZORPAY_KEY_SECRET,
      env.RAZORPAY_WEBHOOK_SECRET,
      env.SUPABASE_SERVICE_ROLE_KEY,
      env.SUPABASE_ANON_KEY,
      env.DATABASE_URL,
      env.SESSION_SECRET,
      env.CERTIFICATE_SIGNING_SECRET,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
