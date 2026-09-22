import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/server/db";
import {
  checkCertificateEligibility,
  createCertificate,
  generateCertificatePdfAndQr,
  generateVerificationHash,
  getCertificateVerification,
  revokeCertificate,
} from "@/server/services/certificate.service";
import { getServerEnv } from "@/lib/env";
import {
  CERTIFICATE_MIN_WPM,
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
} from "@/lib/constants";
import { PDFDocument } from "pdf-lib";
import { nanoid } from "nanoid";
import * as SupabaseServer from "@/lib/supabase/server";

// Mock the Prisma DB
vi.mock("@/server/db", () => ({
  db: {
    user: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
    passage: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    testSession: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    testResult: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    certificate: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock Supabase
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

// Mock env so tests don't depend on real SESSION_SECRET/Supabase/Razorpay vars being set
vi.mock("@/lib/env", () => ({
  getServerEnv: vi.fn(() => ({
    SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
  })),
}));

describe("Certificate Service", () => {
  let user1: any;
  let user2: any;
  let admin: any;
  let passage: any;

  let mockCertificates: any[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCertificates = [];
    user1 = { id: "u1", email: "u1@test.com", displayName: "User 1", role: "USER" };
    user2 = { id: "u2", email: "u2@test.com", displayName: "User 2", role: "USER" };
    admin = { id: "admin1", email: "admin@test.com", role: "ADMIN" };
    passage = {
      id: "p1",
      content: "test passage",
      mode: "CERTIFICATE",
      wordCount: 2,
      charCount: 12,
    };

    (db.user.findUnique as any).mockImplementation(({ where }: any) => {
      if (where.id === admin.id) return Promise.resolve(admin);
      if (where.id === user1.id) return Promise.resolve(user1);
      if (where.id === user2.id) return Promise.resolve(user2);
      return Promise.resolve(null);
    });

    (db.certificate.findUnique as any).mockImplementation(({ where }: any) => {
      const found = mockCertificates.find(
        (c) =>
          (where.certificateId && c.certificateId === where.certificateId) ||
          (where.resultId && c.resultId === where.resultId)
      );
      return Promise.resolve(found || null);
    });

    (db.certificate.findUniqueOrThrow as any).mockImplementation(({ where }: any) => {
      const found = mockCertificates.find(
        (c) =>
          (where.certificateId && c.certificateId === where.certificateId) ||
          (where.resultId && c.resultId === where.resultId)
      );
      if (!found) throw new Error("Certificate not found");
      return Promise.resolve({ ...found, user: user1 });
    });

    (db.certificate.create as any).mockImplementation(({ data }: any) => {
      const cert = { id: nanoid(), ...data };
      mockCertificates.push(cert);
      return Promise.resolve(cert);
    });

    (db.certificate.update as any).mockImplementation(({ where, data }: any) => {
      const idx = mockCertificates.findIndex(
        (c) => c.certificateId === where.certificateId || c.id === where.id
      );
      if (idx !== -1) {
        mockCertificates[idx] = { ...mockCertificates[idx], ...data };
        return Promise.resolve(mockCertificates[idx]);
      }
      throw new Error("Not found");
    });
  });

  function setupResult(overrides: any = {}) {
    const session = {
      id: "s1",
      integrityToken: "token1",
      userId: user1.id,
      passageId: passage.id,
      mode: "CERTIFICATE",
      language: "ENGLISH",
      trustTier: overrides.trustTier || "CERTIFICATE",
      duration:
        overrides.duration !== undefined ? overrides.duration : CERTIFICATE_MIN_DURATION,
      expiresAt: new Date(),
      status: "COMPLETED",
    };

    const result = {
      id: "r1",
      sessionId: session.id,
      userId: user1.id,
      shareId: "share1",
      wpm: overrides.wpm !== undefined ? overrides.wpm : CERTIFICATE_MIN_WPM + 10,
      rawWpm: 50,
      netWpm: overrides.wpm !== undefined ? overrides.wpm : CERTIFICATE_MIN_WPM + 10,
      accuracy: overrides.accuracy !== undefined ? overrides.accuracy : 0.95,
      correctChars: 200,
      incorrectChars: 0,
      totalChars: 200,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: (overrides.duration || CERTIFICATE_MIN_DURATION) * 1000,
      integrityStatus: overrides.integrityStatus || "VERIFIED",
      session,
      user: user1,
    };

    (db.testResult.findUnique as any).mockResolvedValue(result);
    (db.testResult.findUniqueOrThrow as any).mockResolvedValue(result);

    return { session, result };
  }

  describe("Eligibility", () => {
    it("should return eligible for a valid passing test", async () => {
      const { result } = setupResult();
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(true);
      expect(check.reasons.length).toBe(0);
    });

    it("should fail if WPM is below minimum", async () => {
      const { result } = setupResult({ wpm: CERTIFICATE_MIN_WPM - 5 });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
      expect(check.reasons[0]).toContain("Net WPM below minimum");
    });

    it("should fail if accuracy is below minimum", async () => {
      const { result } = setupResult({ accuracy: (CERTIFICATE_MIN_ACCURACY - 1) / 100 });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
      expect(check.reasons[0]).toContain("Accuracy below minimum");
    });

    it("should fail if duration is below minimum", async () => {
      const { result } = setupResult({ duration: CERTIFICATE_MIN_DURATION - 60 });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
      expect(check.reasons[0]).toContain("duration below minimum");
    });

    it("should fail if not VERIFIED", async () => {
      const { result } = setupResult({ integrityStatus: "REVIEW" });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
      expect(check.reasons[0]).toContain("must be VERIFIED");
    });

    it("should fail if not CERTIFICATE tier", async () => {
      const { result } = setupResult({ trustTier: "FREE" });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
      expect(check.reasons[0]).toContain("not taken in CERTIFICATE trust tier");
    });
  });

  describe("Issuance & State Machine", () => {
    it("should issue a PENDING_PAYMENT certificate and snapshot data", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      expect(cert.status).toBe("PENDING_PAYMENT");
      expect(cert.certificateId).toMatch(/^TF-202[0-9]-[A-Z0-9]{6}$/);
      expect(cert.userId).toBe(user1.id);
      expect(cert.wpm).toBe(result.wpm);
      expect(cert.verificationHash).toBeTruthy();
    });

    it("should be idempotent and return existing certificate", async () => {
      const { result } = setupResult();
      const cert1 = await createCertificate(user1.id, result.id);
      const cert2 = await createCertificate(user1.id, result.id);
      expect(cert1.id).toBe(cert2.id);
    });

    it("should prevent user from issuing another user's result", async () => {
      const { result } = setupResult();
      await expect(createCertificate(user2.id, result.id)).rejects.toThrow(
        "Result belongs to another user"
      );
    });

    it("should fail if result is ineligible", async () => {
      const { result } = setupResult({ wpm: 10 }); // too low
      await expect(createCertificate(user1.id, result.id)).rejects.toThrow(
        "Not eligible for certificate"
      );
    });
  });

  describe("Public Verification", () => {
    it("should return safe public data only", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      const verification = await getCertificateVerification(cert.certificateId);
      expect(verification).toBeDefined();
      expect(verification?.certificateId).toBe(cert.certificateId);
      expect(verification?.status).toBe("PENDING_PAYMENT");
      expect(verification?.wpm).toBe(cert.wpm);
      // Ensure secrets are NOT exposed
      expect((verification as any).verificationHash).toBeUndefined();
      expect((verification as any).userId).toBeUndefined();
    });

    it("should return null for non-existent certificate", async () => {
      const verification = await getCertificateVerification("TF-1234-XXXXXX");
      expect(verification).toBeNull();
    });
  });

  describe("Revocation", () => {
    it("should allow ADMIN to revoke", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      const revoked = await revokeCertificate(
        admin.id,
        cert.certificateId,
        "Cheating detected post-issue"
      );
      expect(revoked.status).toBe("REVOKED");
      expect(revoked.revokedReason).toBe("Cheating detected post-issue");
    });

    it("should deny USER from revoking", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      await expect(
        revokeCertificate(user1.id, cert.certificateId, "My reason")
      ).rejects.toThrow("Unauthorized");
    });
  });

  describe("PDF and QR Generation", () => {
    it("should generate a valid PDF and handle storage upload correctly (mocked)", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      const mockUpload = vi.fn().mockResolvedValue({ error: null });
      const mockGetPublicUrl = vi.fn().mockReturnValue({
        data: {
          publicUrl: `https://mock.storage/certificates/${cert.certificateId}.pdf`,
        },
      });

      (SupabaseServer.createAdminClient as any).mockReturnValue({
        storage: {
          from: vi.fn().mockReturnValue({
            upload: mockUpload,
            getPublicUrl: mockGetPublicUrl,
          }),
        },
      });

      const { pdfBytes, pdfUrl, qrDataUrl, certificate } =
        await generateCertificatePdfAndQr(cert.certificateId);

      expect(mockUpload).toHaveBeenCalledWith(
        `certificates/${cert.certificateId}.pdf`,
        expect.anything(),
        { contentType: "application/pdf", upsert: true }
      );
      expect(pdfUrl).toBe(`https://mock.storage/certificates/${cert.certificateId}.pdf`);
      expect(qrDataUrl).toContain("data:image/png;base64,");

      const loadedPdf = await PDFDocument.load(pdfBytes);
      expect(loadedPdf.getPageCount()).toBe(1);
    });

    it("should fallback when upload fails", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      (SupabaseServer.createAdminClient as any).mockReturnValue({
        storage: {
          from: vi.fn().mockReturnValue({
            upload: vi.fn().mockResolvedValue({ error: new Error("Mock network error") }),
          }),
        },
      });

      const { pdfUrl } = await generateCertificatePdfAndQr(cert.certificateId);

      expect(pdfUrl).toBe(
        `https://storage.typeflow.app/certificates/${cert.certificateId}.pdf`
      );
    });
  });
});

describe("generateVerificationHash — SESSION_SECRET configuration", () => {
  afterEach(() => {
    vi.mocked(getServerEnv).mockReturnValue({
      SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
    } as ReturnType<typeof getServerEnv>);
  });

  it("derives the hash from getServerEnv(), not a hardcoded secret", () => {
    const certId = "TF-2026-ABCDEF";
    const userId = "u1";
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");

    vi.mocked(getServerEnv).mockReturnValue({
      SESSION_SECRET: "secret-one-at-least-32-characters-long",
    } as ReturnType<typeof getServerEnv>);
    const hashWithSecretOne = generateVerificationHash(certId, userId, issuedAt);

    vi.mocked(getServerEnv).mockReturnValue({
      SESSION_SECRET: "a-totally-different-secret-32-characters",
    } as ReturnType<typeof getServerEnv>);
    const hashWithSecretTwo = generateVerificationHash(certId, userId, issuedAt);

    // Same inputs, different configured secrets → different hashes proves the
    // secret is read live from getServerEnv(), not a module-level constant.
    expect(hashWithSecretOne).not.toBe(hashWithSecretTwo);
    expect(hashWithSecretOne).toHaveLength(64); // sha256 hex digest
  });

  it("fails closed when SESSION_SECRET is missing/invalid instead of falling back", () => {
    vi.mocked(getServerEnv).mockImplementation(() => {
      throw new Error("Invalid server environment variables. See above.");
    });

    expect(() =>
      generateVerificationHash("TF-2026-ABCDEF", "u1", new Date())
    ).toThrow("Invalid server environment variables");
  });
});
