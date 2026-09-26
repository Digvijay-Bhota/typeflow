import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/server/db";
import {
  checkCertificateEligibility,
  createCertificate,
  generateVerificationHash,
  renderCertificatePdf,
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
import { createHash, createHmac } from "crypto";
import { pdfFontNames } from "../setup/pdfFonts";

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
      updateMany: vi.fn(),
    },
  },
}));

// Mock Supabase
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(),
}));

// Mock env so tests don't depend on real signing/Supabase/Razorpay vars being set
vi.mock("@/lib/env", () => ({
  getServerEnv: vi.fn(() => ({
    CERTIFICATE_SIGNING_SECRET: "test-certificate-signing-secret-32-characters",
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

    (db.certificate.updateMany as any).mockImplementation(({ where, data }: any) => {
      const matching = mockCertificates.filter(
        (c) =>
          (c.certificateId === where.certificateId || c.id === where.id) &&
          c.status !== where.status?.not
      );
      for (const c of matching) Object.assign(c, data);
      return Promise.resolve({ count: matching.length });
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
      scoringSource: overrides.scoringSource || "SERVER_RECONSTRUCTED",
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

    it("should fail if CLIENT_COUNTS + VERIFIED", async () => {
      const { result } = setupResult({
        integrityStatus: "VERIFIED",
        scoringSource: "CLIENT_COUNTS",
      });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
      expect(check.reasons[0]).toContain("VERIFIED");
    });

    it("should fail if SERVER_RECONSTRUCTED + REVIEW", async () => {
      const { result } = setupResult({
        integrityStatus: "REVIEW",
        scoringSource: "SERVER_RECONSTRUCTED",
      });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
    });

    it("should fail if SERVER_RECONSTRUCTED + INVALID", async () => {
      const { result } = setupResult({
        integrityStatus: "INVALID",
        scoringSource: "SERVER_RECONSTRUCTED",
      });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(false);
    });

    it("should pass if SERVER_RECONSTRUCTED + VERIFIED (with correct metrics)", async () => {
      const { result } = setupResult({
        integrityStatus: "VERIFIED",
        scoringSource: "SERVER_RECONSTRUCTED",
      });
      const check = await checkCertificateEligibility(result.id);
      expect(check.eligible).toBe(true);
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
      // An unpaid certificate is not verified and reveals no details.
      expect(verification).toEqual({
        certificateId: cert.certificateId,
        state: "PENDING",
        message: expect.any(String),
      });
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
      expect(revoked.revokedReason).toBe("ADMIN: Cheating detected post-issue");
    });

    it("should deny USER from revoking", async () => {
      const { result } = setupResult();
      const cert = await createCertificate(user1.id, result.id);

      await expect(
        revokeCertificate(user1.id, cert.certificateId, "My reason")
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(mockCertificates[0]?.status).toBe("PENDING_PAYMENT");
    });
  });

  describe("PDF rendering", () => {
    const snapshot = {
      certificateId: "TF-2026-ABCDEF",
      testType: "TIMED Typing Assessment",
      language: "ENGLISH" as const,
      duration: 300,
      wpm: 61.4,
      accuracy: 0.975,
      issuedAt: new Date("2026-09-01T10:00:00.000Z"),
      recipientName: "User 1",
    };
    const verifyUrl = "http://localhost:3000/verify/TF-2026-ABCDEF";

    it("renders a one-page PDF", async () => {
      const bytes = await renderCertificatePdf(snapshot, verifyUrl);
      const loadedPdf = await PDFDocument.load(bytes);
      expect(loadedPdf.getPageCount()).toBe(1);
      expect(loadedPdf.getCreationDate()?.toISOString()).toBe(
        snapshot.issuedAt.toISOString()
      );
    });

    it("is deterministic, so a retried upload writes identical bytes", async () => {
      const a = await renderCertificatePdf(snapshot, verifyUrl);
      const b = await renderCertificatePdf(snapshot, verifyUrl);
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    });

    describe("recipient names", () => {
      const render = (recipientName: string) =>
        renderCertificatePdf({ ...snapshot, recipientName }, verifyUrl);
      const sha256 = (bytes: Uint8Array) =>
        createHash("sha256").update(bytes).digest("hex");
      const LATIN = ["Helvetica", "Helvetica-Bold"];
      const WITH_DEVANAGARI = [...LATIN, "NotoSansDevanagari-Regular"];

      it("renders Latin names byte-for-byte as before Unicode support", async () => {
        // Captured from the Helvetica-only renderer this replaced, with the
        // same snapshot and verify URL. A pdf-lib or qrcode upgrade may
        // legitimately change them; re-capture only then.
        const before: Record<string, string> = {
          "User 1": "d5acdf8ea0863b6c4dc8d1f7612f888ed5bdc075553e30a142ac9545e87e8ded",
          "Anonymous Typist":
            "462b8e04e9e2b67e92baf5defe7150ffd1e3e160d0f6b04a749d4d3aa12c9b85",
          "José Müller-Øster":
            "0bf1c0c2ea4332790793201892747b747817bd1af4a8431efcce24d6ee7b276d",
          "Anne-Marie O'Neil, Jr.":
            "e1c9e3868c491fea93294a9815251ef11c815ed444ef6b49b391f0528e5efde3",
        };
        for (const [name, hash] of Object.entries(before)) {
          expect(sha256(await render(name))).toBe(hash);
        }
        expect(await pdfFontNames(await render("User 1"))).toEqual(LATIN);
      });

      it("renders a Hindi name with the embedded, subsetted Devanagari font", async () => {
        const bytes = await render("प्रिया शर्मा");
        expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
        expect(await pdfFontNames(bytes)).toEqual(WITH_DEVANAGARI);
        // Only the glyphs used are embedded, not the whole 221 KB font.
        expect(bytes.length).toBeLessThan(20_000);
        expect(sha256(bytes)).toBe(sha256(await render("प्रिया शर्मा")));
      });

      it("renders mixed Latin and Devanagari names", async () => {
        const bytes = await render("Priya (प्रिया) Sharma");
        expect(await pdfFontNames(bytes)).toEqual(WITH_DEVANAGARI);
      });

      it("renders punctuation-heavy Latin names with Helvetica only", async () => {
        expect(
          await pdfFontNames(await render("O'Brien-Smith, Jr. (Dr.) & Co."))
        ).toEqual(LATIN);
      });

      it("renders a name in an unsupported script as the fixed fallback, not a partial name", async () => {
        const chinese = await render("李明");
        expect(await pdfFontNames(chinese)).toEqual(LATIN);
        // Every unsupported name yields the same bytes: nothing of it is drawn.
        expect(sha256(chinese)).toBe(sha256(await render("王小明")));
        expect(sha256(chinese)).toBe(sha256(await render("Ming 李")));
      });

      it("drops emoji deterministically", async () => {
        expect(sha256(await render("Sam 🚀 Lee"))).toBe(sha256(await render("Sam Lee")));
        expect(sha256(await render("🚀🔥"))).toBe(sha256(await render("李明")));
      });

      it("renders the longest stored names (100 characters) on one page", async () => {
        for (const name of ["W".repeat(100), "क्षत्रिय ".repeat(12).slice(0, 100)]) {
          const bytes = await render(name);
          expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
          expect(sha256(bytes)).toBe(sha256(await render(name)));
        }
      });

      it("falls back to the fixed text if the Devanagari font cannot be drawn", async () => {
        const embedFont = PDFDocument.prototype.embedFont;
        const spy = vi
          .spyOn(PDFDocument.prototype, "embedFont")
          .mockImplementation(function (this: PDFDocument, font, options) {
            if (typeof font !== "string")
              return Promise.reject(new Error("embed failed"));
            return embedFont.call(this, font, options);
          });
        try {
          expect(sha256(await render("प्रिया शर्मा"))).toBe(sha256(await render("李明")));
        } finally {
          spy.mockRestore();
        }
      });
    });
  });
});

describe("generateVerificationHash — CERTIFICATE_SIGNING_SECRET configuration", () => {
  const certId = "TF-2026-ABCDEF";
  const userId = "u1";
  const issuedAt = new Date("2026-01-01T00:00:00.000Z");
  const withEnv = (env: Record<string, string>) =>
    vi.mocked(getServerEnv).mockReturnValue(env as ReturnType<typeof getServerEnv>);

  afterEach(() => {
    withEnv({
      CERTIFICATE_SIGNING_SECRET: "test-certificate-signing-secret-32-characters",
    });
  });

  it("derives the hash from the dedicated signing secret, not a hardcoded secret", () => {
    withEnv({ CERTIFICATE_SIGNING_SECRET: "signing-secret-one-at-least-32-characters" });
    const hashWithSecretOne = generateVerificationHash(certId, userId, issuedAt);

    withEnv({ CERTIFICATE_SIGNING_SECRET: "a-totally-different-signing-secret-32ch" });
    const hashWithSecretTwo = generateVerificationHash(certId, userId, issuedAt);

    // Same inputs, different configured secrets → different hashes proves the
    // secret is read live from getServerEnv(), not a module-level constant.
    expect(hashWithSecretOne).not.toBe(hashWithSecretTwo);
    expect(hashWithSecretOne).toHaveLength(64); // sha256 hex digest
    expect(hashWithSecretOne).toBe(
      createHmac("sha256", "signing-secret-one-at-least-32-characters")
        .update(`${certId}:${userId}:${issuedAt.toISOString()}`)
        .digest("hex")
    );
  });

  it("is independent of SESSION_SECRET (rotating it keeps certificates valid)", () => {
    const signing = "signing-secret-one-at-least-32-characters";
    withEnv({
      CERTIFICATE_SIGNING_SECRET: signing,
      SESSION_SECRET: "session-secret-one-at-least-32-characters",
    });
    const before = generateVerificationHash(certId, userId, issuedAt);

    withEnv({
      CERTIFICATE_SIGNING_SECRET: signing,
      SESSION_SECRET: "rotated-session-secret-at-least-32-chars",
    });
    expect(generateVerificationHash(certId, userId, issuedAt)).toBe(before);
  });

  it("fails closed when the signing secret is missing/invalid instead of falling back", () => {
    vi.mocked(getServerEnv).mockImplementation(() => {
      throw new Error("Invalid server environment variables. See above.");
    });

    expect(() => generateVerificationHash(certId, userId, new Date())).toThrow(
      "Invalid server environment variables"
    );
  });
});
