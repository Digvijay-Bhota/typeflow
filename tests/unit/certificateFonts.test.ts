import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import nextConfig from "../../next.config";
import { DEVANAGARI_FONT_FILE, loadDevanagariFont } from "@/server/lib/certificateFonts";
import { renderCertificatePdf } from "@/server/services/certificate.service";

vi.mock("@/server/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({}) }));

const REPO_ROOT = resolve(__dirname, "../..");

const snapshot = {
  certificateId: "TF-2026-ABCDEF",
  testType: "TIMED Typing Assessment",
  language: "ENGLISH" as const,
  duration: 300,
  wpm: 61.4,
  accuracy: 0.975,
  issuedAt: new Date("2026-09-01T10:00:00.000Z"),
  recipientName: "प्रिया शर्मा",
};
const verifyUrl = "http://localhost:3000/verify/TF-2026-ABCDEF";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("certificate font asset", () => {
  it("is bundled in the repository with its OFL license", () => {
    const font = resolve(REPO_ROOT, DEVANAGARI_FONT_FILE);
    expect(existsSync(font)).toBe(true);
    expect(statSync(font).size).toBeLessThan(300_000);
    const license = readFileSync(resolve(font, "../OFL.txt"), "utf8");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  it("is traced into every function that renders certificates", () => {
    const includes = nextConfig.outputFileTracingIncludes ?? {};
    for (const route of [
      "/api/payment/webhook",
      "/api/certificate/fulfill",
      "/api/cron/reconcile-payments",
    ]) {
      expect(includes[route]).toContain(`./${DEVANAGARI_FONT_FILE}`);
    }
  });
});

describe("loadDevanagariFont", () => {
  // Runs first, before any successful load is cached in this file.
  it("fails the render (retryably) when the font file is missing from the deployment", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/nonexistent");
    await expect(renderCertificatePdf(snapshot, verifyUrl)).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Latin names never need the file.
    await expect(
      renderCertificatePdf({ ...snapshot, recipientName: "Priya Sharma" }, verifyUrl)
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("loads again after a failed attempt, then reuses the loaded font", async () => {
    const first = await loadDevanagariFont();
    expect(await loadDevanagariFont()).toBe(first);
    expect(first.covers("क".codePointAt(0)!)).toBe(true);
    expect(first.covers("李".codePointAt(0)!)).toBe(false);
    expect(first.widthOfTextAtSize("प्रिया", 18)).toBeGreaterThan(0);
  });
});
