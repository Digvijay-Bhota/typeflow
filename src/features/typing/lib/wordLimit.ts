/**
 * Word-count test passages.
 *
 * A words test is typed against the first `wordCount` words of its passage,
 * so it ends on the last character of the final word and shows no text past
 * it. Words are separated by spaces — the same boundary the typing engine's
 * word index advances on.
 */

/**
 * The passage prefix holding its first `wordCount` words.
 *
 * Cuts just before the `wordCount`-th space, so the prefix ends on the last
 * character of the final word (no trailing space to type). Character indices
 * are unchanged: a trace typed against the prefix indexes the full passage
 * identically.
 *
 * @param passage The full passage text
 * @param wordCount Words the test asks for (≤ 0 or non-finite → no limit)
 * @returns The prefix, or the whole passage when it has no more words than that
 */
export function limitToWords(passage: string, wordCount: number): string {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return passage;

  let spaces = 0;
  for (let i = 0; i < passage.length; i++) {
    if (passage[i] === " ") {
      spaces += 1;
      if (spaces === wordCount) return passage.slice(0, i);
    }
  }
  return passage;
}

/**
 * Words in a passage, counted the way limitToWords cuts them.
 *
 * Formula: (number of spaces) + 1, or 0 for empty text
 *
 * A passage supports a words test of `n` words exactly when
 * countWords(passage) ≥ n: limitToWords then returns a prefix of exactly `n`
 * words instead of the whole (shorter) passage.
 *
 * @param passage The passage text
 * @returns The number of space-separated words
 */
export function countWords(passage: string): number {
  if (passage.length === 0) return 0;

  let spaces = 0;
  for (let i = 0; i < passage.length; i++) {
    if (passage[i] === " ") spaces += 1;
  }
  return spaces + 1;
}
