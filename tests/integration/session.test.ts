import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSession,
  startSession,
  submitResult,
} from "@/server/services/session.service";
import { getResultByShareId } from "@/server/services/result.service";
import { db } from "@/server/db";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: null }),
}));

// Mock the Prisma DB
vi.mock("@/server/db", () => ({
  db: {
    passage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    testSession: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    testResult: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(db)), // run transaction inline
  },
}));

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));

describe("Session & Result Service Integration (Mocked DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSession", () => {
    it("should create a FREE session successfully", async () => {
      const mockPassage = {
        id: "p1",
        content: "test passage",
        language: "ENGLISH",
        mode: "NORMAL",
        difficulty: "INTERMEDIATE",
        wordCount: 2,
        charCount: 12,
      };
      const mockSession = {
        id: "s1",
        mode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        trustTier: "FREE",
        expiresAt: new Date(),
        integrityToken: "token",
      };

      (db.passage.findMany as any).mockResolvedValue([mockPassage]);
      (db.testSession.create as any).mockResolvedValue(mockSession);

      const res = await createSession({
        mode: "timed",
        language: "english",
        duration: 60,
      });

      expect(db.testSession.create).toHaveBeenCalled();
      expect(res.sessionId).toBe("s1");
      expect(res.trustTier).toBe("FREE");
    });
  });

  describe("startSession", () => {
    it("should start a session atomically", async () => {
      const mockSession = {
        id: "s1",
        status: "ACTIVE",
        integrityToken: "t1",
        userId: null,
        startedAt: new Date(),
        expiresAt: new Date(),
      };

      (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
      (db.testSession.findUniqueOrThrow as any).mockResolvedValue(mockSession);

      const res = await startSession({ sessionId: "s1", integrityToken: "t1" });

      expect(db.testSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "s1", status: "PENDING" }),
        })
      );
      expect(res.status).toBe("ACTIVE");
    });

    it("should throw error if session is not pending or already started", async () => {
      (db.testSession.updateMany as any).mockResolvedValue({ count: 0 }); // update failed
      (db.testSession.findUnique as any).mockResolvedValue({
        status: "ACTIVE",
        integrityToken: "t1",
        userId: null,
        expiresAt: new Date(Date.now() + 10000),
      }); // found but active

      await expect(
        startSession({ sessionId: "s1", integrityToken: "t1" })
      ).rejects.toThrow(/Session is already ACTIVE/);
    });
  });

  describe("submitResult", () => {
    it("should process valid submission and mark completed", async () => {
      const mockSession = {
        id: "s1",
        status: "ACTIVE",
        integrityToken: "t1",
        userId: null,
        startedAt: new Date(Date.now() - 30000), // 30s ago
        duration: 30, // 30s timed test
        expiresAt: new Date(Date.now() + 100000),
        passage: { content: "test" },
      };

      const mockResult = {
        id: "r1",
        shareId: "share1",
        wpm: 60,
        accuracy: 1.0,
        integrityStatus: "VERIFIED",
      };

      (db.testSession.findUnique as any).mockResolvedValue(mockSession);
      (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
      (db.testResult.create as any).mockResolvedValue(mockResult);

      const res = await submitResult({
        sessionId: "s1",
        integrityToken: "t1",
        metrics: {
          wpm: 60,
          rawWpm: 60,
          accuracy: 1.0,
          correctChars: 150,
          incorrectChars: 0,
          totalChars: 150,
          correctedErrors: 0,
          uncorrectedErrors: 0,
          consistency: 0.9,
        },
        integritySignals: {
          pasteAttempts: 0,
          copyAttempts: 0,
          focusLossCount: 0,
          visibilityChanges: 0,
          suspiciousPattern: false,
          intervalWpms: [],
          selectionAttempts: 0,
        },
      });

      expect(res.shareId).toBe("share1");
      expect(db.testSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        })
      );
      expect(db.testResult.create).toHaveBeenCalled();

      // Verify claim token is in payload but not in URL
      expect(res).toHaveProperty("claimToken");
      expect(res.shareUrl).toBe(`/result/${res.shareId}`);
      expect(res.shareUrl).not.toContain("claimToken");
      expect(res.shareUrl).not.toContain(res.claimToken);
    });

    it("should reject submission if integrityToken does not match", async () => {
      const mockSession = {
        id: "s1",
        status: "ACTIVE",
        integrityToken: "valid-token",
        userId: null,
      };
      (db.testSession.findUnique as any).mockResolvedValue(mockSession);

      await expect(
        submitResult({
          sessionId: "s1",
          integrityToken: "wrong-token",
          metrics: {
            wpm: 60,
            rawWpm: 60,
            accuracy: 1,
            correctChars: 150,
            incorrectChars: 0,
            totalChars: 150,
            correctedErrors: 0,
            uncorrectedErrors: 0,
            consistency: 0.9,
          },
          integritySignals: {
            pasteAttempts: 0,
            copyAttempts: 0,
            focusLossCount: 0,
            visibilityChanges: 0,
            suspiciousPattern: false,
            intervalWpms: [],
            selectionAttempts: 0,
          },
        })
      ).rejects.toThrow("Invalid integrity token");
    });

    it("should reject submission if duration exceeded grace period", async () => {
      const mockSession = {
        id: "s1",
        status: "ACTIVE",
        integrityToken: "t1",
        userId: null,
        startedAt: new Date(Date.now() - 100000), // started 100s ago!
        duration: 30, // 30s test -> maximum allowed is 30s + grace
        expiresAt: new Date(Date.now() + 100000),
        passage: { content: "test" },
      };
      (db.testSession.findUnique as any).mockResolvedValue(mockSession);

      await expect(
        submitResult({
          sessionId: "s1",
          integrityToken: "t1",
          clientElapsedMs: 30000,
          metrics: {
            wpm: 60,
            rawWpm: 60,
            accuracy: 1,
            correctChars: 150,
            incorrectChars: 0,
            totalChars: 150,
            correctedErrors: 0,
            uncorrectedErrors: 0,
            consistency: 0.9,
          },
          integritySignals: {
            pasteAttempts: 0,
            copyAttempts: 0,
            focusLossCount: 0,
            visibilityChanges: 0,
            suspiciousPattern: false,
            intervalWpms: [],
            selectionAttempts: 0,
          },
        })
      ).rejects.toThrow(/duration exceeded grace period/);
    });

    it("should reject submission if session expired", async () => {
      const mockSession = {
        id: "s1",
        status: "ACTIVE",
        integrityToken: "t1",
        userId: null,
        startedAt: new Date(Date.now() - 30000),
        duration: null, // words mode or no duration
        expiresAt: new Date(Date.now() - 10000), // expired 10s ago
        passage: { content: "test" },
      };
      (db.testSession.findUnique as any).mockResolvedValue(mockSession);

      await expect(
        submitResult({
          sessionId: "s1",
          integrityToken: "t1",
          clientElapsedMs: 30000,
          metrics: {
            wpm: 60,
            rawWpm: 60,
            accuracy: 1,
            correctChars: 150,
            incorrectChars: 0,
            totalChars: 150,
            correctedErrors: 0,
            uncorrectedErrors: 0,
            consistency: 0.9,
          },
          integritySignals: {
            pasteAttempts: 0,
            copyAttempts: 0,
            focusLossCount: 0,
            visibilityChanges: 0,
            suspiciousPattern: false,
            intervalWpms: [],
            selectionAttempts: 0,
          },
        })
      ).rejects.toThrow(/Session has expired/);
    });

    it("should reject duplicate/completed session submission", async () => {
      // Mock session already completed
      const mockSession = {
        id: "s1",
        status: "COMPLETED",
        integrityToken: "t1",
        userId: null,
      };
      (db.testSession.findUnique as any).mockResolvedValue(mockSession);

      await expect(
        submitResult({
          sessionId: "s1",
          integrityToken: "t1",
          metrics: {
            wpm: 60,
            rawWpm: 60,
            accuracy: 1,
            correctChars: 150,
            incorrectChars: 0,
            totalChars: 150,
            correctedErrors: 0,
            uncorrectedErrors: 0,
            consistency: null,
          },
          integritySignals: {
            pasteAttempts: 0,
            copyAttempts: 0,
            focusLossCount: 0,
            visibilityChanges: 0,
            suspiciousPattern: false,
            intervalWpms: [],
            selectionAttempts: 0,
          },
        })
      ).rejects.toThrow(/not ACTIVE/);
    });
  });

  describe("getResultByShareId", () => {
    it("should return public result correctly", async () => {
      (db.testResult.findUnique as any).mockResolvedValue({
        id: "r1",
        shareId: "share1",
        wpm: 60,
        rawWpm: 60,
        netWpm: 60,
        accuracy: 1,
        consistency: null,
        correctChars: 150,
        incorrectChars: 0,
        totalChars: 150,
        correctedErrors: 0,
        uncorrectedErrors: 0,
        elapsedMs: 30000,
        duration: 30,
        integrityStatus: "VERIFIED",
        createdAt: new Date(),
        session: { trustTier: "FREE", passage: {} },
      });

      const res = await getResultByShareId("share1");
      expect(res?.shareId).toBe("share1");
      expect(res?.isCertificateEligible).toBe(false); // FREE tier
    });
  });

  describe("Code Language Routing", () => {
    it("should request JavaScript passages when codeLanguage is javascript", async () => {
      (db.passage.findMany as any).mockResolvedValue([
        {
          id: "js-passage",
          content: "console.log('hi')",
          language: "CODE",
          codeLanguage: "JAVASCRIPT",
        },
      ]);
      (db.testSession.create as any).mockResolvedValue({
        id: "js-session",
        expiresAt: new Date(),
      });

      await createSession({
        mode: "timed",
        language: "code",
        codeLanguage: "javascript",
        duration: 60,
      });

      expect(db.passage.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          language: "CODE",
          codeLanguage: "JAVASCRIPT",
        }),
      });
    });

    it("should request general code passages when codeLanguage is omitted", async () => {
      (db.passage.findMany as any).mockResolvedValue([
        { id: "gen-code", content: "hello world", language: "CODE" },
      ]);
      (db.testSession.create as any).mockResolvedValue({
        id: "gen-session",
        expiresAt: new Date(),
      });

      await createSession({
        mode: "timed",
        language: "code",
        duration: 60,
      });

      expect(db.passage.findMany).toHaveBeenCalledWith({
        where: expect.not.objectContaining({
          codeLanguage: expect.anything(),
        }),
      });
    });

    it("should request English passages for normal english tests", async () => {
      (db.passage.findMany as any).mockResolvedValue([
        { id: "eng", content: "english", language: "ENGLISH" },
      ]);
      (db.testSession.create as any).mockResolvedValue({
        id: "eng-session",
        expiresAt: new Date(),
      });

      await createSession({
        mode: "timed",
        language: "english",
        duration: 60,
      });

      expect(db.passage.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          language: "ENGLISH",
        }),
      });
      expect(db.passage.findMany).toHaveBeenCalledWith({
        where: expect.not.objectContaining({
          codeLanguage: expect.anything(),
        }),
      });
    });
  });
});
