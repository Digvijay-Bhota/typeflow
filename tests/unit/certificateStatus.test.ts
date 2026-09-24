/**
 * The single certificate status rules: public verification, the owner's view
 * and when checkout may be offered.
 */
import { describe, it, expect } from "vitest";
import {
  canStartCheckout,
  certificateOwnerState,
  certificateVerifyPath,
  CERTIFICATE_ID_PATTERN,
  verificationState,
  VERIFICATION_MESSAGES,
  type CertificateStatusValue,
} from "@/lib/certificateStatus";

const now = new Date("2026-09-24T00:00:00Z");
const past = new Date("2026-09-01T00:00:00Z");
const future = new Date("2027-09-01T00:00:00Z");

describe("verificationState", () => {
  it("verifies only an ACTIVE, unexpired certificate with valid verification data", () => {
    expect(verificationState({ status: "ACTIVE" }, true, now)).toBe("VERIFIED");
    expect(verificationState({ status: "ACTIVE", expiresAt: future }, true, now)).toBe(
      "VERIFIED"
    );
    expect(verificationState({ status: "ACTIVE" }, false, now)).toBe("INVALID");
    expect(verificationState({ status: "ACTIVE", expiresAt: past }, true, now)).toBe(
      "EXPIRED"
    );
  });

  it.each([
    ["PENDING_PAYMENT", "PENDING"],
    ["PENDING_FULFILLMENT", "PROCESSING"],
    ["REVOKED", "REVOKED"],
    ["EXPIRED", "EXPIRED"],
  ] as const)("%s is never verified (→ %s), even with a valid hash", (status, state) => {
    expect(verificationState({ status }, true, now)).toBe(state);
  });

  it("has a message for every state", () => {
    for (const message of Object.values(VERIFICATION_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
    }
  });
});

describe("certificateOwnerState / canStartCheckout", () => {
  it.each<
    [
      CertificateStatusValue | null,
      "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED" | null,
      string,
      boolean,
    ]
  >([
    [null, null, "NONE", true],
    ["PENDING_PAYMENT", null, "PENDING_PAYMENT", true],
    ["PENDING_PAYMENT", "PENDING", "PENDING_PAYMENT", true],
    ["PENDING_PAYMENT", "FAILED", "PENDING_PAYMENT", true],
    ["PENDING_PAYMENT", "COMPLETED", "PROCESSING", false],
    ["PENDING_PAYMENT", "REFUNDED", "PROCESSING", false],
    ["PENDING_FULFILLMENT", "COMPLETED", "PROCESSING", false],
    ["ACTIVE", "COMPLETED", "ACTIVE", false],
    ["REVOKED", "REFUNDED", "REVOKED", false],
    ["REVOKED", "COMPLETED", "REVOKED", false],
    ["EXPIRED", "COMPLETED", "EXPIRED", false],
  ])("%s + payment %s → %s (checkout: %s)", (status, payment, state, checkout) => {
    const owner = certificateOwnerState(status ? { status } : null, payment, now);
    expect(owner).toBe(state);
    expect(canStartCheckout(owner)).toBe(checkout);
  });

  it("treats an ACTIVE certificate past expiresAt as expired", () => {
    expect(
      certificateOwnerState({ status: "ACTIVE", expiresAt: past }, "COMPLETED", now)
    ).toBe("EXPIRED");
  });
});

describe("certificate IDs and routes", () => {
  it("builds the canonical verification path", () => {
    expect(certificateVerifyPath("TF-2026-ABC123")).toBe("/verify/TF-2026-ABC123");
  });

  it("accepts generated IDs and rejects anything else", () => {
    expect(CERTIFICATE_ID_PATTERN.test("TF-2026-ABC123")).toBe(true);
    for (const bad of [
      "",
      "TF-2026-abc123",
      "TF-2026-ABC12",
      "../etc",
      "TF-2026-ABC123 ",
    ]) {
      expect(CERTIFICATE_ID_PATTERN.test(bad)).toBe(false);
    }
  });
});
