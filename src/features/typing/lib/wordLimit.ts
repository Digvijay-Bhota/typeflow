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
