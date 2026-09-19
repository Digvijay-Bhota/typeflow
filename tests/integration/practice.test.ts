import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateTargetedPassage } from "@/server/services/practice.service";
import { createSession } from "@/server/services/session.service";
import { db } from "@/server/db";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: "user-123" }),
}));

vi.mock("@/server/db", () => ({
  db: {
    passage: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    testResult: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    testSession: {
      create: vi.fn(),
    },
  },
}));

describe("Targeted Practice Loop", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("should deterministically reuse existing generated passage", async () => {
    const weakKeys = ["a", "s"];
    (db.passage.findUnique as any).mockResolvedValueOnce({
      id: "existing-passage",
      content: "a s a s",
      sourceAttribution: "Generated for weak keys: a,s",
    });

    const passage = await generateTargetedPassage("ENGLISH", weakKeys);
    expect(passage.id).toBe("existing-passage");
    expect(db.passage.findUnique).toHaveBeenCalled();
    expect(db.passage.create).not.toHaveBeenCalled();
  });

  it("should generate a new passage if none exists and filter weak keys", async () => {
    const weakKeys = ["x", "z"];
    (db.passage.findUnique as any).mockResolvedValueOnce(null);
    (db.passage.findMany as any).mockResolvedValueOnce([
      {
        content:
          "hello world exact zebra xylophone xylophone2 xylophone3 xylophone4 xylophone5 xylophone6 xylophone7 xylophone8 test",
      },
    ]);
    (db.passage.create as any).mockImplementationOnce((args: any) => ({
      id: "new-passage",
      ...args.data,
    }));

    const passage = await generateTargetedPassage("ENGLISH", weakKeys, 5);
    expect(db.passage.create).toHaveBeenCalled();
    expect(passage.content).toMatch(/exact|zebra|xylophone/);
    expect(passage.sourceAttribution).toBe("Generated for weak keys: x,z");
  });

  it("should create a practice session correctly deriving weak keys from dashboard (recent results)", async () => {
    (db.testResult.findMany as any).mockResolvedValueOnce([
      { errorMap: { a: { expected: "a", count: 10 }, b: { expected: "b", count: 5 } } },
      { errorMap: { c: { expected: "c", count: 20 } } },
    ]);

    (db.passage.findUnique as any).mockResolvedValueOnce({
      id: "practice-passage",
      content: "test",
      sourceAttribution: "Generated for weak keys: c,a,b",
    });

    (db.testSession.create as any).mockResolvedValueOnce({
      id: "session-1",
      mode: "PRACTICE",
      language: "ENGLISH",
      expiresAt: new Date(),
    });

    const res = await createSession({
      mode: "practice" as any,
      language: "english",
    });

    expect(db.testResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-123" } })
    );
    expect(res.mode).toBe("PRACTICE");
    expect(res.passage.id).toBe("practice-passage");
  });

  it("should derive weak keys from sourceResultId if provided", async () => {
    (db.testResult.findUnique as any).mockResolvedValueOnce({
      id: "result-1",
      userId: "user-123", // MATCHES
      errorMap: { z: { expected: "z", count: 100 } },
    });

    (db.passage.findUnique as any).mockResolvedValueOnce({
      id: "practice-passage",
      content: "zebra",
    });

    (db.testSession.create as any).mockResolvedValueOnce({
      id: "session-1",
      mode: "PRACTICE",
      language: "ENGLISH",
      expiresAt: new Date(),
    });

    await createSession({
      mode: "practice" as any,
      language: "english",
      sourceResultId: "result-1" as any,
    });

    expect(db.testResult.findUnique).toHaveBeenCalledWith({
      where: { id: "result-1" },
    });
  });

  it("should enforce IDOR protection on sourceResultId", async () => {
    (db.testResult.findUnique as any).mockResolvedValueOnce({
      id: "result-1",
      userId: "other-user-456",
      errorMap: { z: { expected: "z", count: 100 } },
    });

    (db.passage.findFirst as any).mockResolvedValueOnce({
      id: "generic-passage",
      content: "hello",
    });

    (db.testSession.create as any).mockResolvedValueOnce({
      id: "session-2",
      mode: "PRACTICE",
      language: "ENGLISH",
      expiresAt: new Date(),
    });

    await expect(
      createSession({
        mode: "practice" as any,
        language: "english",
        sourceResultId: "result-1" as any,
      })
    ).rejects.toThrow("UNAUTHORIZED_PRACTICE");
  });
});
