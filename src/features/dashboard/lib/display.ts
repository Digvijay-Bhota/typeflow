/**
 * Display helpers for the authenticated workspace (Phase 8.4): labels and
 * formats for values the server has already computed. Pure, no data access.
 */

const MODE_LABELS: Record<string, string> = {
  TIMED: "Timed",
  WORDS: "Words",
  ZEN: "Zen",
  CODE: "Code",
  CERTIFICATE: "Certified",
  PRACTICE: "Practice",
};

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  java: "Java",
  cpp: "C++",
  sql: "SQL",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** A TypingMode enum value as users read it ("CERTIFICATE" → "Certified"). */
export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? titleCase(mode);
}

/**
 * The test's language: the code language for code tests, else "English"/"Hindi".
 * The database stores code languages as enum values ("TYPESCRIPT"), the app's
 * constants in lower case ("typescript"); both are accepted.
 */
export function languageLabel(language: string, codeLanguage?: string | null): string {
  if (codeLanguage)
    return CODE_LANGUAGE_LABELS[codeLanguage.toLowerCase()] ?? codeLanguage;
  return titleCase(language);
}

/** Total practice time: "0m", "<1m", "42m", "2h", "1h 5m". */
export function formatPracticeTime(ms: number): string {
  if (ms <= 0) return "0m";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** A test's configured length in seconds: "30s", "1 min", "5 min", "1m 30s". */
export function formatTestLength(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Change in WPM between two tests: "+3 WPM", "−2 WPM", "No change". */
export function formatWpmDelta(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return "No change";
  return rounded > 0 ? `+${rounded} WPM` : `−${Math.abs(rounded)} WPM`;
}

/** A key from an error map: what to draw, and what a screen reader should say. */
export function keyLabel(key: string): { visual: string; spoken: string } {
  if (key === " ") return { visual: "␣", spoken: "space" };
  if (key === "\n") return { visual: "↵", spoken: "enter" };
  if (key === "\t") return { visual: "⇥", spoken: "tab" };
  return { visual: key, spoken: key };
}

/** "1 test", "3 tests"; pass the plural when it is not word + "s" ("misses"). */
export function pluralize(count: number, word: string, plural = `${word}s`): string {
  return `${count} ${count === 1 ? word : plural}`;
}
