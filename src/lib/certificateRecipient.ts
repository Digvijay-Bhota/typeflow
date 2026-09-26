/**
 * Recipient-name layout for the certificate PDF.
 *
 * The PDF's standard font (Helvetica, WinAnsi encoding) cannot draw most
 * non-Latin text, so a name is split into runs that each go to a font able to
 * draw them: "latin" (Helvetica) or "devanagari" (embedded Noto Sans
 * Devanagari). Pure and deterministic: fonts are passed in as coverage and
 * width callbacks, so the same name always yields the same line.
 *
 *  - Emoji, control and invisible format characters are removed; the text is
 *    NFC-normalized and whitespace collapsed.
 *  - A name with any character neither font can draw (e.g. CJK), or nothing
 *    left after cleaning, is replaced as a whole by RECIPIENT_FALLBACK_TEXT —
 *    never by a partial name. The verification page (HTML) shows the real one.
 *  - A line wider than the available width is shrunk down to
 *    RECIPIENT_MIN_FONT_SIZE, then cut at a grapheme boundary and ended
 *    with "…".
 */

export type RecipientFontName = "latin" | "devanagari";

export type RecipientRun = { font: RecipientFontName; text: string };

export type RecipientLine = {
  /** Label and name, in drawing order; adjacent runs never share a font. */
  runs: RecipientRun[];
  size: number;
  /** The name did not fit even at the minimum size and was cut. */
  truncated: boolean;
  /** The name was replaced by RECIPIENT_FALLBACK_TEXT. */
  fallback: boolean;
};

export type RecipientCoverage = Record<RecipientFontName, (codePoint: number) => boolean>;

export type RecipientMeasure = (
  font: RecipientFontName,
  text: string,
  size: number
) => number;

export const RECIPIENT_LABEL = "Recipient: ";
export const RECIPIENT_FALLBACK_TEXT = "(see verification page)";
export const RECIPIENT_FONT_SIZE = 18;
export const RECIPIENT_MIN_FONT_SIZE = 11;
/** From the line's x (50) to just before the WPM column (x = 400). */
export const RECIPIENT_MAX_WIDTH = 340;
/** Upper bound on the graphemes considered; more can never fit the line. */
export const RECIPIENT_MAX_GRAPHEMES = 200;

const ELLIPSIS = "…";
const ZWNJ = 0x200c;
const ZWJ = 0x200d;

// Extended_Pictographic also covers ©, ® and ™, which Helvetica draws and
// Latin names may legitimately contain; they are kept.
const EMOJI =
  /(?![©®™])\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\p{Variation_Selector}|⃣|[\u{E0020}-\u{E007F}]/gu;
const CONTROL = /\p{Cc}/gu;
const WHITESPACE = /[\s\p{Z}]+/gu;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

function isDevanagari(codePoint: number): boolean {
  return (
    (codePoint >= 0x0900 && codePoint <= 0x097f) ||
    (codePoint >= 0xa8e0 && codePoint <= 0xa8ff) ||
    (codePoint >= 0x1cd0 && codePoint <= 0x1cff)
  );
}

/**
 * Removes what the PDF cannot or should not draw. ZWJ/ZWNJ are kept only
 * after Devanagari, where they select conjunct forms; elsewhere (e.g. left
 * over from an emoji sequence) they are dropped with the other invisible
 * format characters.
 */
export function sanitizeRecipientName(name: string): string {
  const cleaned = name.normalize("NFC").replace(EMOJI, "").replace(CONTROL, " ");

  let out = "";
  let previous: number | undefined;
  for (const char of cleaned) {
    const codePoint = char.codePointAt(0) ?? 0;
    const isJoiner = codePoint === ZWJ || codePoint === ZWNJ;
    const keep = isJoiner
      ? previous !== undefined && isDevanagari(previous)
      : !/[\p{Cf}\p{Cs}]/u.test(char);
    if (keep) {
      out += char;
      previous = codePoint;
    }
  }
  return out.replace(WHITESPACE, " ").trim();
}

/** True if the name has Devanagari text, i.e. the PDF needs that font. */
export function needsDevanagariFont(name: string): boolean {
  return Array.from(sanitizeRecipientName(name)).some((c) =>
    isDevanagari(c.codePointAt(0) ?? 0)
  );
}

function splitGraphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function fontFor(
  grapheme: string,
  coverage: RecipientCoverage
): RecipientFontName | null {
  const codePoints = Array.from(grapheme, (c) => c.codePointAt(0) ?? 0);
  if (codePoints.every(coverage.latin)) return "latin";
  if (codePoints.every(coverage.devanagari)) return "devanagari";
  return null;
}

type Grapheme = { font: RecipientFontName; text: string };

/**
 * Assigns each grapheme a font, or returns null if any grapheme has none.
 * Spaces and punctuation stay with the run before them, so "प्रिया शर्मा" is
 * one Devanagari run rather than three runs split around the space.
 */
function assignFonts(
  graphemes: string[],
  coverage: RecipientCoverage
): Grapheme[] | null {
  const result: Grapheme[] = [];
  for (const text of graphemes) {
    const previous = result.at(-1)?.font;
    const neutral = !LETTER_OR_NUMBER.test(text);
    const codePoints = Array.from(text, (c) => c.codePointAt(0) ?? 0);
    if (neutral && previous && codePoints.every(coverage[previous])) {
      result.push({ font: previous, text });
      continue;
    }
    const font = fontFor(text, coverage);
    if (!font) return null;
    result.push({ font, text });
  }
  return result;
}

function toRuns(graphemes: Grapheme[]): RecipientRun[] {
  const runs: RecipientRun[] = [];
  for (const g of graphemes) {
    const last = runs.at(-1);
    if (last && last.font === g.font) last.text += g.text;
    else runs.push({ font: g.font, text: g.text });
  }
  return runs;
}

function lineWidth(
  runs: RecipientRun[],
  size: number,
  measure: RecipientMeasure
): number {
  return runs.reduce((sum, run) => sum + measure(run.font, run.text, size), 0);
}

function withLabel(graphemes: Grapheme[]): Grapheme[] {
  return [{ font: "latin", text: RECIPIENT_LABEL }, ...graphemes];
}

/**
 * Lays out the "Recipient: <name>" line. `name` is the display name as
 * shown elsewhere (already defaulted for a missing name).
 */
export function layoutRecipientLine(
  name: string,
  coverage: RecipientCoverage,
  measure: RecipientMeasure
): RecipientLine {
  const all = splitGraphemes(sanitizeRecipientName(name));
  const assigned = all.length > 0 ? assignFonts(all, coverage) : null;
  const fallback = assigned === null;
  const nameGraphemes = assigned ?? [
    { font: "latin" as const, text: RECIPIENT_FALLBACK_TEXT },
  ];
  const capped = nameGraphemes.length > RECIPIENT_MAX_GRAPHEMES;
  const graphemes = nameGraphemes.slice(0, RECIPIENT_MAX_GRAPHEMES);

  if (!capped) {
    const runs = toRuns(withLabel(graphemes));
    for (let size = RECIPIENT_FONT_SIZE; size >= RECIPIENT_MIN_FONT_SIZE; size--) {
      if (lineWidth(runs, size, measure) <= RECIPIENT_MAX_WIDTH) {
        return { runs, size, truncated: false, fallback };
      }
    }
  }

  // Too long even at the minimum size: keep the longest prefix that fits
  // together with the ellipsis, at worst none of the name.
  const size = RECIPIENT_MIN_FONT_SIZE;
  const truncatedRuns = (keep: number) => {
    const prefix = graphemes.slice(0, keep);
    while (prefix.length > 0 && prefix.at(-1)?.text.trim() === "") prefix.pop();
    return toRuns([...withLabel(prefix), { font: "latin", text: ELLIPSIS }]);
  };
  for (let keep = capped ? graphemes.length : graphemes.length - 1; keep > 0; keep--) {
    const runs = truncatedRuns(keep);
    if (lineWidth(runs, size, measure) <= RECIPIENT_MAX_WIDTH) {
      return { runs, size, truncated: true, fallback };
    }
  }
  return { runs: truncatedRuns(0), size, truncated: true, fallback };
}
