/**
 * Certificate session foundation (Phase 4D step 2): the public certificate
 * page must produce a real 300 s CERTIFICATE session on a certificate passage,
 * and no client-supplied tier can grant B2B.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { db } from "@/server/db";
import { createSession } from "@/server/services/session.service";
import { CreateSessionSchema } from "@/schemas/session.schema";
import { POST as createRoute } from "@/app/api/session/create/route";
import { getSeoRouteConfig } from "@/app/(seo)/[seoSlug]/seoConfig";
import { CERTIFICATE_MIN_DURATION, CERTIFICATE_MIN_PASSAGE_CHARS } from "@/lib/constants";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));

const post = (body: unknown) =>
  createRoute(
    new Request("http://localhost/api/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const passageMode = async (passageId: string) =>
  (await db.passage.findUniqueOrThrow({ where: { id: passageId } })).mode;

beforeAll(async () => {
  // Guarantee both kinds of active English passage exist in the test DB. A
  // certificate passage must be long enough to last the whole test.
  const certificateContent = "certificate passage for the certificate session tests "
    .repeat(Math.ceil(CERTIFICATE_MIN_PASSAGE_CHARS / 54))
    .trim();
  await db.passage.create({
    data: {
      content: certificateContent,
      wordCount: certificateContent.split(/\s+/).length,
      charCount: certificateContent.length,
      mode: "CERTIFICATE",
    },
  });
  await db.passage.create({
    data: {
      content: "normal passage for the certificate session tests",
      wordCount: 7,
      charCount: 48,
      mode: "NORMAL",
    },
  });
});

describe("certificate landing page", () => {
  const config = getSeoRouteConfig("typing-test-with-certificate")!;

  it("is configured as a 300 s CERTIFICATE test", () => {
    expect(config.testConfig).toMatchObject({
      mode: "timed",
      duration: CERTIFICATE_MIN_DURATION,
      trustTier: "CERTIFICATE",
    });
  });

  it("produces a 300 s CERTIFICATE session on a certificate passage", async () => {
    // The body TypingTest sends for this page.
    const { mode, language, duration, trustTier } = config.testConfig;
    const res = await post({ mode, language, duration, trustTier });

    expect(res.status).toBe(201);
    const session = await res.json();
    expect(session.trustTier).toBe("CERTIFICATE");
    expect(session.duration).toBe(300);
    expect(session.mode).toBe("TIMED");
    expect(await passageMode(session.passage.id)).toBe("CERTIFICATE");

    const row = await db.testSession.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(row.trustTier).toBe("CERTIFICATE");
    expect(row.duration).toBe(300);
  });
});

describe("CERTIFICATE tier", () => {
  it.each([
    ["trustTier", { trustTier: "CERTIFICATE" as const }],
    ["certificateMode", { certificateMode: true }],
  ])("is granted via %s with a certificate passage", async (_label, tier) => {
    const session = await createSession({
      mode: "timed",
      language: "english",
      duration: 300,
      ...tier,
    });
    expect(session.trustTier).toBe("CERTIFICATE");
    expect(await passageMode(session.passage.id)).toBe("CERTIFICATE");
  });

  it.each([15, 30, 60, 120, 180])("rejects a %s s certificate test", async (duration) => {
    const body = {
      mode: "timed" as const,
      language: "english" as const,
      duration,
      trustTier: "CERTIFICATE" as const,
    };
    expect(CreateSessionSchema.safeParse(body).success).toBe(false);

    const res = await post(body);
    expect(res.status).toBe(400);

    // The service enforces it too, for any caller that skips the route.
    await expect(createSession(body)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a non-timed certificate test", async () => {
    const res = await post({
      mode: "words",
      language: "english",
      wordCount: 50,
      trustTier: "CERTIFICATE",
    });
    expect(res.status).toBe(400);
  });
});

describe("B2B cannot be claimed by the client", () => {
  it("rejects trustTier B2B_ASSESSMENT without an invite and attempt", async () => {
    const res = await post({
      mode: "timed",
      language: "english",
      duration: 60,
      trustTier: "B2B_ASSESSMENT",
    });
    expect(res.status).toBe(400);
  });

  it("never creates a B2B session from trustTier alone (service level)", async () => {
    const session = await createSession({
      mode: "timed",
      language: "english",
      duration: 60,
      trustTier: "B2B_ASSESSMENT",
    });
    expect(session.trustTier).toBe("FREE");
  });

  it("rejects a forged invite + attempt", async () => {
    const res = await post({
      mode: "timed",
      language: "english",
      duration: 60,
      trustTier: "B2B_ASSESSMENT",
      inviteToken: "not-a-real-invite",
      attemptId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(404);
  });
});

describe("FREE behaviour unchanged", () => {
  it.each([
    ["no trustTier", {}],
    ["trustTier FREE", { trustTier: "FREE" as const }],
  ])("%s → FREE session on a NORMAL passage", async (_label, tier) => {
    const res = await post({ mode: "timed", language: "english", duration: 60, ...tier });
    expect(res.status).toBe(201);
    const session = await res.json();
    expect(session.trustTier).toBe("FREE");
    expect(await passageMode(session.passage.id)).toBe("NORMAL");
  });

  it("still allows a FREE 300 s test", async () => {
    const res = await post({ mode: "timed", language: "english", duration: 300 });
    expect(res.status).toBe(201);
    expect((await res.json()).trustTier).toBe("FREE");
  });
});
