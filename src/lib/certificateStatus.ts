/**
 * Certificate lifecycle rules shared by the services, the public verification
 * page and the result page. Pure and client-safe (no secrets, no Prisma).
 *
 * State machine (Certificate.status):
 *
 *   PENDING_PAYMENT ──payment.captured──▶ PENDING_FULFILLMENT ──PDF+QR stored──▶ ACTIVE
 *          │                                      │                               │
 *          └──────────── full refund processed / admin revocation ────────────────┴──▶ REVOKED
 *
 * REVOKED is terminal. EXPIRED (or an elapsed expiresAt) is never verified.
 */

export type CertificateStatusValue =
  | "PENDING_PAYMENT"
  | "PENDING_FULFILLMENT"
  | "ACTIVE"
  | "REVOKED"
  | "EXPIRED";

export type PaymentStatusValue = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";

/** Public route of a certificate's verification page. The QR code encodes this. */
export function certificateVerifyPath(certificateId: string): string {
  return `/verify/${encodeURIComponent(certificateId)}`;
}

/** Shape of every generated certificate ID (TF-YYYY-XXXXXX). */
export const CERTIFICATE_ID_PATTERN = /^[A-Z]{2}-\d{4}-[A-Z0-9]{6}$/;

function isExpired(expiresAt: Date | null | undefined, now: Date): boolean {
  return !!expiresAt && expiresAt.getTime() <= now.getTime();
}

export type VerificationState =
  | "VERIFIED"
  | "PENDING"
  | "PROCESSING"
  | "REVOKED"
  | "EXPIRED"
  | "INVALID";

/**
 * The single verification rule: only an ACTIVE, unexpired certificate whose
 * stored verification data is valid is verified. Everything else is not.
 */
export function verificationState(
  cert: { status: CertificateStatusValue; expiresAt?: Date | null },
  verificationDataValid: boolean,
  now: Date = new Date()
): VerificationState {
  switch (cert.status) {
    case "REVOKED":
      return "REVOKED";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING_PAYMENT":
      return "PENDING";
    case "PENDING_FULFILLMENT":
      return "PROCESSING";
    case "ACTIVE":
      if (isExpired(cert.expiresAt, now)) return "EXPIRED";
      return verificationDataValid ? "VERIFIED" : "INVALID";
  }
}

export const VERIFICATION_MESSAGES: Record<VerificationState, string> = {
  VERIFIED: "This certificate is authentic and currently valid.",
  PENDING: "This certificate has not been activated, so it cannot be verified.",
  PROCESSING: "This certificate is being prepared and is not valid yet.",
  REVOKED: "This certificate has been revoked and is no longer valid.",
  EXPIRED: "This certificate has expired and is no longer valid.",
  INVALID: "This certificate could not be verified.",
};

/** What the owner of a result sees about its certificate. */
export type CertificateOwnerState =
  | "NONE"
  | "PENDING_PAYMENT"
  | "PROCESSING"
  | "ACTIVE"
  | "REVOKED"
  | "EXPIRED";

export function certificateOwnerState(
  cert: { status: CertificateStatusValue; expiresAt?: Date | null } | null,
  paymentStatus: PaymentStatusValue | null,
  now: Date = new Date()
): CertificateOwnerState {
  if (!cert) return "NONE";
  switch (cert.status) {
    case "REVOKED":
      return "REVOKED";
    case "EXPIRED":
      return "EXPIRED";
    case "ACTIVE":
      return isExpired(cert.expiresAt, now) ? "EXPIRED" : "ACTIVE";
    case "PENDING_FULFILLMENT":
      return "PROCESSING";
    case "PENDING_PAYMENT":
      // Paid but not yet moved on (e.g. held for review): never offer checkout again.
      return paymentStatus === "COMPLETED" || paymentStatus === "REFUNDED"
        ? "PROCESSING"
        : "PENDING_PAYMENT";
  }
}

/** A result's certificate as shown to its owner. */
export type OwnerCertificate = {
  state: CertificateOwnerState;
  /** Public certificate ID (TF-…), once one has been issued. */
  certificateId: string | null;
};

/** Checkout is offered only while nothing has been paid for this result. */
export function canStartCheckout(state: CertificateOwnerState): boolean {
  return state === "NONE" || state === "PENDING_PAYMENT";
}
