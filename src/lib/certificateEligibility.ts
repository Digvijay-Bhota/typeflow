/**
 * Certificate eligibility — the single source of truth.
 *
 * Used by certificate issuance, the leaderboard, and public result views so
 * "isCertificateEligible" can never drift from what issuance actually allows.
 */
import {
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_MIN_WPM,
} from "@/lib/constants";

export interface CertificateEligibilityInput {
  netWpm: number;
  /** Ratio 0–1 */
  accuracy: number;
  /** Test duration in seconds (from the session) */
  duration: number | null;
  integrityStatus: string;
  scoringSource: string;
  trustTier: string;
  userId: string | null;
}

export interface CertificateEligibility {
  eligible: boolean;
  /**
   * Every requirement except the signed-in owner is met: an unclaimed guest
   * result that becomes eligible once claimed into an account.
   */
  eligibleOnceSignedIn: boolean;
  reasons: string[];
  thresholdSummary: {
    wpm: { actual: number; required: number; passed: boolean };
    accuracy: { actual: number; required: number; passed: boolean };
    duration: { actual: number; required: number; passed: boolean };
  };
}

/**
 * A result is trusted only when its metrics were reconstructed server-side
 * from a valid event trace AND it passed every integrity check.
 */
export function isTrustedResult(result: {
  integrityStatus: string;
  scoringSource: string;
}): boolean {
  return (
    result.integrityStatus === "VERIFIED" &&
    result.scoringSource === "SERVER_RECONSTRUCTED"
  );
}

export function evaluateCertificateEligibility(
  input: CertificateEligibilityInput
): CertificateEligibility {
  const duration = input.duration || 0;
  const wpmPassed = input.netWpm >= CERTIFICATE_MIN_WPM;
  const accPassed = input.accuracy * 100 >= CERTIFICATE_MIN_ACCURACY;
  const durationPassed = duration >= CERTIFICATE_MIN_DURATION;
  const isTrusted = isTrustedResult(input);
  const isCertMode = input.trustTier === "CERTIFICATE";

  const reasons: string[] = [];
  if (!wpmPassed)
    reasons.push(
      `Net WPM below minimum (${input.netWpm.toFixed(1)} < ${CERTIFICATE_MIN_WPM})`
    );
  if (!accPassed)
    reasons.push(
      `Accuracy below minimum (${(input.accuracy * 100).toFixed(1)}% < ${CERTIFICATE_MIN_ACCURACY}%)`
    );
  if (!durationPassed)
    reasons.push(
      `Test duration below minimum (${duration}s < ${CERTIFICATE_MIN_DURATION}s)`
    );
  if (!isTrusted)
    reasons.push(
      `Result must be VERIFIED and SERVER_RECONSTRUCTED (is ${input.integrityStatus} / ${input.scoringSource})`
    );
  if (!isCertMode) reasons.push(`Test was not taken in CERTIFICATE trust tier`);
  if (!input.userId) reasons.push(`User must be authenticated`);

  const meetsResultRequirements =
    wpmPassed && accPassed && durationPassed && isTrusted && isCertMode;

  return {
    eligible: meetsResultRequirements && !!input.userId,
    eligibleOnceSignedIn: meetsResultRequirements,
    reasons,
    thresholdSummary: {
      wpm: { actual: input.netWpm, required: CERTIFICATE_MIN_WPM, passed: wpmPassed },
      accuracy: {
        actual: input.accuracy * 100,
        required: CERTIFICATE_MIN_ACCURACY,
        passed: accPassed,
      },
      duration: {
        actual: duration,
        required: CERTIFICATE_MIN_DURATION,
        passed: durationPassed,
      },
    },
  };
}
