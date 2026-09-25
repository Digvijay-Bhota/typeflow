/**
 * TEMPORARY — Phase 5B Preview webhook-signature diagnostics. Remove once the
 * Razorpay signature mismatch is explained.
 *
 * Runs only after verification has already failed, and never changes the
 * outcome: the webhook is still rejected. Logs non-sensitive metadata only —
 * never the secret, the signature, the raw body, or any HMAC value. The
 * secret-variation checks are booleans that show whether the configured
 * secret differs from Razorpay's by a copy/paste artefact; none of them is
 * ever used to accept a webhook.
 */
import { createHash, createHmac } from "crypto";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const hmacHex = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

export function signatureMismatchDiagnostics(
  payloadRawString: string,
  signature: string,
  headers: Headers
) {
  const env = getServerEnv();
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  const matches = (candidate: string) =>
    hmacHex(candidate, payloadRawString) === signature.toLowerCase();
  const unquoted = secret.trim().replace(/^(["'])(.*)\1$/, "$2");
  const bodyBytes = Buffer.byteLength(payloadRawString, "utf8");
  const contentLength = headers.get("content-length");

  return {
    bodyByteLength: bodyBytes,
    bodySha256: createHash("sha256").update(payloadRawString).digest("hex"),
    bodyHasNonAscii: /[^\x00-\x7f]/.test(payloadRawString),
    contentLengthMatchesBody:
      contentLength === null ? null : Number(contentLength) === bodyBytes,
    contentType: headers.get("content-type"),
    contentEncoding: headers.get("content-encoding"),
    signatureIs64Hex: /^[0-9a-fA-F]{64}$/.test(signature),
    configuredSecretLength: secret.length,
    matchExactSecret: matches(secret),
    matchSecretPlusNewline: matches(`${secret}\n`),
    matchSecretPlusSpace: matches(`${secret} `),
    matchSecretTrimmed: matches(secret.trim()),
    matchSecretUnquoted: matches(unquoted),
    // Was the Razorpay API key secret saved as the webhook secret by mistake?
    matchRazorpayKeySecret: matches(env.RAZORPAY_KEY_SECRET),
  };
}

export function logSignatureMismatchDiagnostics(
  payloadRawString: string,
  signature: string,
  headers: Headers
) {
  try {
    logger.warn(
      "TEMP Phase 5B webhook signature diagnostics",
      signatureMismatchDiagnostics(payloadRawString, signature, headers)
    );
  } catch {
    // Diagnostics must never affect the webhook response.
  }
}
