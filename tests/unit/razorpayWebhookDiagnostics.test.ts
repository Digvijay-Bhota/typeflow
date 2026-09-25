/** TEMPORARY — covers the Phase 5B webhook-signature diagnostics; remove with them. */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";
import { __clearServerEnvForTesting } from "@/lib/env";
import { signatureMismatchDiagnostics } from "@/server/services/razorpayWebhookDiagnostics";

const SECRET = "test-only-diagnostics-webhook-secret-0123456789abcdef";
const BODY = '{"event":"payment.captured","payload":{"note":"₹"}}';
const sign = (secret: string) => createHmac("sha256", secret).update(BODY).digest("hex");
const headers = new Headers({ "content-type": "application/json" });

beforeAll(() => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
  __clearServerEnvForTesting();
});
afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

describe("signatureMismatchDiagnostics", () => {
  it("flags only the variation Razorpay actually signed with", () => {
    const d = signatureMismatchDiagnostics(BODY, sign(`${SECRET}\n`), headers);
    expect(d).toMatchObject({
      matchExactSecret: false,
      matchSecretPlusNewline: true,
      matchSecretPlusSpace: false,
      signatureIs64Hex: true,
      bodyHasNonAscii: true,
      bodyByteLength: Buffer.byteLength(BODY, "utf8"),
      contentType: "application/json",
      contentEncoding: null,
    });
  });

  it("reports no match for an unrelated secret", () => {
    const d = signatureMismatchDiagnostics(BODY, sign("something-else"), headers);
    expect([
      d.matchExactSecret,
      d.matchSecretPlusNewline,
      d.matchSecretPlusSpace,
      d.matchSecretTrimmed,
      d.matchSecretUnquoted,
    ]).toEqual([false, false, false, false, false]);
  });

  it("never includes the secret, the signature, the body, or an HMAC", () => {
    const signature = sign("something-else");
    const out = JSON.stringify(signatureMismatchDiagnostics(BODY, signature, headers));
    for (const sensitive of [SECRET, signature, BODY, sign(SECRET)]) {
      expect(out).not.toContain(sensitive);
    }
  });
});
