/**
 * Application-wide constants.
 *
 * These are pure data — no imports from other app modules.
 * Safe to import in any context (client, server, test).
 */

// ─── App ─────────────────────────────────────────────────────────────────────

export const APP_NAME = "TypeFlow" as const;
export const APP_TAGLINE = "Practice smarter. Type faster. Prove your skills." as const;
export const APP_DESCRIPTION =
  "TypeFlow is a typing performance and career-readiness platform. Practice adaptive typing, code typing, and earn verified certificates." as const;

// ─── Test durations (seconds) ────────────────────────────────────────────────

export const TEST_DURATIONS = [15, 30, 60, 120, 180, 300] as const;
export type TestDuration = (typeof TEST_DURATIONS)[number];

export const DEFAULT_DURATION: TestDuration = 60;

// ─── Word counts ─────────────────────────────────────────────────────────────

export const WORD_COUNTS = [10, 25, 50, 100, 200] as const;
export type WordCount = (typeof WORD_COUNTS)[number];

export const DEFAULT_WORD_COUNT: WordCount = 50;

// ─── Typing modes ────────────────────────────────────────────────────────────

export const TYPING_MODES = [
  "timed",
  "words",
  "zen",
  "code",
  "certificate",
  "practice",
] as const;
export type TypingMode = (typeof TYPING_MODES)[number];

// ─── Languages ───────────────────────────────────────────────────────────────

export const LANGUAGES = ["english", "hindi", "code"] as const;
export type Language = (typeof LANGUAGES)[number];

export const CODE_LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "java",
  "cpp",
  "sql",
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

// ─── Difficulty ───────────────────────────────────────────────────────────────

export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// ─── Certificate ─────────────────────────────────────────────────────────────

/** Minimum WPM to be eligible for a certificate (configurable server-side) */
export const CERTIFICATE_MIN_WPM = 30;

/** Minimum accuracy to be eligible for a certificate */
export const CERTIFICATE_MIN_ACCURACY = 90;

/** Minimum duration for a certifiable test (seconds) */
export const CERTIFICATE_MIN_DURATION: TestDuration = 300;

/** Certificate price in paise (smallest currency unit, 49900 = 499 INR) */
export const CERTIFICATE_PRICE_INR = 49900;

/** Certificate ID prefix */
export const CERTIFICATE_ID_PREFIX = "TF";

/** Certificate base verify URL path */
export const CERTIFICATE_VERIFY_PATH = "/verify";

// ─── Integrity classifications ───────────────────────────────────────────────

export const INTEGRITY_STATUS = {
  VERIFIED: "VERIFIED",
  REVIEW: "REVIEW",
  INVALID: "INVALID",
} as const;
export type IntegrityStatus = keyof typeof INTEGRITY_STATUS;

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Standard: 1 word = 5 characters (space-inclusive).
 * Industry standard used by all major typing test platforms.
 */
export const CHARS_PER_WORD = 5 as const;

/** The minimum ms between keystrokes to be considered plausible (anti-cheat) */
export const MIN_KEYSTROKE_INTERVAL_MS = 20 as const;

/** Maximum plausible WPM for a human typist */
export const MAX_PLAUSIBLE_WPM = 300 as const;

// ─── Session ─────────────────────────────────────────────────────────────────

/** Session expiry: 30 minutes from creation */
export const SESSION_EXPIRY_MS = 30 * 60 * 1000;

// ─── Subscription plans ──────────────────────────────────────────────────────

export const SUBSCRIPTION_PLANS = ["FREE", "PRO"] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/**
 * Pro Monthly price in paise (smallest currency unit).
 * 49900 paise = ₹499/month
 * SERVER-AUTHORITATIVE: never trust client-supplied price.
 */
export const PRO_MONTHLY_PRICE_PAISE = 49900; // ₹499/month

/**
 * Pro Yearly price in paise.
 * 399900 paise = ₹3999/year (~33% off monthly)
 * SERVER-AUTHORITATIVE: never trust client-supplied price.
 */
export const PRO_YEARLY_PRICE_PAISE = 399900; // ₹3999/year

/**
 * Pro Monthly period (in months, used with Razorpay plan).
 */
export const PRO_MONTHLY_PERIOD = 1 as const;

/**
 * Pro Yearly period (in months, used with Razorpay plan).
 */
export const PRO_YEARLY_PERIOD = 12 as const;

/**
 * PRO_PLAN_IDS maps interval → Razorpay plan ID.
 * Set via environment variables; validated at startup.
 * These are not hardcoded here to avoid committing IDs to source.
 */

/**
 * Subscription plan display prices (for UI only — do NOT use for payment processing).
 */
export const PRO_MONTHLY_PRICE_DISPLAY = "₹499" as const;
export const PRO_YEARLY_PRICE_DISPLAY = "₹3,999" as const;
export const PRO_YEARLY_MONTHLY_DISPLAY = "₹333" as const; // effective per month

/**
 * Feature matrix: what each plan provides.
 * Keep this centralized. Do NOT scatter "PRO" checks throughout the app.
 */
export const FEATURE_MATRIX = {
  FREE: [
    "basic_typing_tests",
    "basic_result",
    "basic_history",
    "basic_session_analytics",
    "standard_themes",
  ],
  PRO: [
    "basic_typing_tests",
    "basic_result",
    "basic_history",
    "basic_session_analytics",
    "standard_themes",
    // Pro-exclusive
    "advanced_result_analytics",
    "long_term_trend_analysis",
    "weak_key_training",
    "advanced_practice_sessions",
    "custom_sound_packs",
    "custom_themes",
    "exportable_performance_report",
  ],
} as const;

export type Feature = (typeof FEATURE_MATRIX)["PRO"][number];

/**
 * Pro-exclusive features. Use this set to gate access server-side.
 * DO NOT use localStorage or client role for access decisions.
 */
export const PRO_FEATURES = new Set<Feature>([
  "advanced_result_analytics",
  "long_term_trend_analysis",
  "weak_key_training",
  "advanced_practice_sessions",
  "custom_sound_packs",
  "custom_themes",
  "exportable_performance_report",
]);

/**
 * Valid subscription billing intervals.
 */
export const SUBSCRIPTION_INTERVALS = ["monthly", "yearly"] as const;
export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number];

// ─── Payment ─────────────────────────────────────────────────────────────────

export const PAYMENT_CURRENCY = "INR" as const;

// ─── SEO routes ──────────────────────────────────────────────────────────────

export const SEO_ROUTES = [
  "/typing-test",
  "/1-minute-typing-test",
  "/3-minute-typing-test",
  "/5-minute-typing-test",
  "/english-typing-test",
  "/hindi-typing-test",
  "/code-typing-test",
  "/javascript-typing-test",
  "/typescript-typing-test",
  "/python-typing-test",
  "/java-typing-test",
  "/cpp-typing-test",
  "/sql-typing-test",
  "/typing-test-for-beginners",
  "/typing-test-with-certificate",
  "/typing-speed-guide",
  "/how-wpm-is-calculated",
  "/how-to-increase-typing-speed",
] as const;
