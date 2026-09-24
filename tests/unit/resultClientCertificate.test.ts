/**
 * The result page's certificate panel follows the authoritative
 * `isCertificateEligible` flag (evaluateCertificateEligibility) and the
 * server-read certificate state, and mounts checkout only for the signed-in
 * owner while nothing has been paid.
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CertificateGuestFallback,
  ResultClient,
} from "@/features/analytics/components/ResultClient";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import { GuestClaimActions } from "@/features/auth/components/GuestClaimBanner";
import type { OwnerCertificate } from "@/lib/certificateStatus";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const CHECKOUT = "Get Verified Certificate";
const PRICE = `₹${(CERTIFICATE_PRICE_INR / 100).toLocaleString("en-IN")}`;

const render = (
  overrides: Record<string, unknown>,
  certificate: OwnerCertificate | null = null
) =>
  renderToStaticMarkup(
    React.createElement(ResultClient, {
      certificate,
      result: {
        shareId: "s1",
        wpm: 60,
        rawWpm: 60,
        accuracy: 0.97,
        consistency: null,
        integrityStatus: "VERIFIED",
        scoringSource: "SERVER_RECONSTRUCTED",
        intervalWpms: [],
        weakKeys: [],
        session: {
          mode: "TIMED",
          language: "ENGLISH",
          trustTier: "CERTIFICATE",
          duration: 300,
        },
        ...overrides,
      },
    })
  );

describe("ResultClient certificate panel", () => {
  it("shows the checkout action, priced from CERTIFICATE_PRICE_INR, to an eligible owner", () => {
    const html = render({ id: "result-uuid", isCertificateEligible: true });
    expect(html).toContain("meets the official requirements");
    expect(html).toContain(`${CHECKOUT} (${PRICE})`);
    expect(html).not.toContain("Claim Certificate"); // the old placeholder
  });

  it("follows the flag even below the old hard-coded 40 WPM / 95% rule", () => {
    const html = render({
      id: "r",
      wpm: 35,
      accuracy: 0.92,
      isCertificateEligible: true,
    });
    expect(html).toContain(CHECKOUT);
  });

  it("does not show checkout to a viewer who is not the owner (no result id)", () => {
    const html = render({ isCertificateEligible: true });
    expect(html).toContain("meets the official requirements");
    expect(html).not.toContain(CHECKOUT);
  });

  it("shows no checkout for an ineligible result, with the real thresholds", () => {
    const html = render({ id: "r", wpm: 120, accuracy: 1, isCertificateEligible: false });
    expect(html).toContain("Keep practicing");
    expect(html).not.toContain(CHECKOUT);
    expect(html).toContain("5-minute test with at least 30 net WPM and 90% accuracy");
  });

  it("treats a missing flag as not eligible", () => {
    const html = render({ id: "r" });
    expect(html).not.toContain(CHECKOUT);
  });

  it("sends a qualifying guest result to sign in / claim, never to checkout", () => {
    const html = render({
      isCertificateEligible: false,
      certificateEligibleAfterClaim: true,
    });
    expect(html).toContain("Sign in or create an account");
    expect(html).not.toContain(CHECKOUT);
  });

  it("shows no certificate panel outside the CERTIFICATE tier", () => {
    const html = render({
      id: "r",
      isCertificateEligible: true,
      session: { mode: "TIMED", language: "ENGLISH", trustTier: "FREE", duration: 60 },
    });
    expect(html).not.toContain("Certificate Eligibility");
    expect(html).not.toContain(CHECKOUT);
  });
});

describe("ResultClient certificate panel — purchase state", () => {
  const owner = { id: "result-uuid", isCertificateEligible: true };
  const cert = (state: OwnerCertificate["state"]): OwnerCertificate => ({
    state,
    certificateId: "TF-2026-ABC123",
  });

  it("still offers checkout for an eligible owner's unpaid (PENDING_PAYMENT) certificate", () => {
    const html = render(owner, cert("PENDING_PAYMENT"));
    expect(html).toContain(`${CHECKOUT} (${PRICE})`);
    expect(html).toContain("Certificate Eligibility");
  });

  it("offers checkout when no certificate exists yet", () => {
    expect(render(owner, { state: "NONE", certificateId: null })).toContain(CHECKOUT);
  });

  it("paid / being prepared: no checkout, a status check instead", () => {
    const html = render(owner, cert("PROCESSING"));
    expect(html).not.toContain(CHECKOUT);
    expect(html).toContain("being prepared");
    expect(html).toContain("Check Certificate Status");
  });

  it("ACTIVE: no checkout, links to the canonical verification page", () => {
    const html = render(owner, cert("ACTIVE"));
    expect(html).not.toContain(CHECKOUT);
    expect(html).toContain("is active");
    expect(html).toContain('href="/verify/TF-2026-ABC123"');
  });

  it.each([
    ["REVOKED", "revoked"],
    ["EXPIRED", "expired"],
  ] as const)("%s: no checkout and no action", (state, text) => {
    const html = render(owner, cert(state));
    expect(html).not.toContain(CHECKOUT);
    expect(html).toContain(text);
    expect(html).not.toContain("Check Certificate Status");
    expect(html).not.toContain("/verify/");
  });
});

describe("guest claim actions", () => {
  it("links sign-in and sign-up with the claim token", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuestClaimActions, { claimToken: "tok_123" })
    );
    expect(html).toContain('href="/login?claimToken=tok_123"');
    expect(html).toContain('href="/signup?claimToken=tok_123"');
  });

  it("without a claim token, still offers sign-in and a signed-in retake (no dead end)", () => {
    const html = renderToStaticMarkup(React.createElement(CertificateGuestFallback));
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/typing-test-with-certificate"');
    expect(html).not.toContain(CHECKOUT);
  });
});
