/**
 * Auto-scroll policy for the typing viewport.
 *
 * Keeps the line holding the active character visible with context around it:
 * one already-typed line above and one upcoming line below. While that holds,
 * nothing scrolls, so ordinary keystrokes never trigger a scroll. Once the
 * active line leaves that safe band (typing onto the last visible line, or
 * backspacing onto a line above it), the viewport jumps so the active line
 * becomes the second visible line again.
 *
 * All positions are in the scroll container's content coordinates
 * (element offset + scrollTop), so the result does not depend on a smooth
 * scroll that is still in flight.
 */

/** Already-typed lines kept visible above the active line. */
export const CONTEXT_LINES_ABOVE = 1;
/** Upcoming lines kept visible below the active line. */
export const CONTEXT_LINES_BELOW = 1;

export interface ActiveLineScrollInput {
  /** Top of the active line box, in content coordinates. */
  lineTop: number;
  /** Height of one line box. */
  lineHeight: number;
  /** Scroll offset the viewport is at, or is already animating towards. */
  scrollTop: number;
  /** Visible height of the viewport. */
  viewportHeight: number;
  /** scrollHeight - clientHeight. */
  maxScrollTop: number;
}

/**
 * Returns the scroll offset to move to, or null when the active line is
 * already comfortably visible.
 *
 * Context shrinks on viewports too short to fit it, so the active line itself
 * is never pushed out of view.
 */
export function nextActiveLineScrollTop({
  lineTop,
  lineHeight,
  scrollTop,
  viewportHeight,
  maxScrollTop,
}: ActiveLineScrollInput): number | null {
  const spare = Math.max(0, viewportHeight - lineHeight);
  const contextAbove = Math.min(lineHeight * CONTEXT_LINES_ABOVE, spare / 2);
  const contextBelow = Math.min(lineHeight * CONTEXT_LINES_BELOW, spare / 2);

  const visibleWithContext =
    lineTop - contextAbove >= scrollTop &&
    lineTop + lineHeight + contextBelow <= scrollTop + viewportHeight;
  if (visibleWithContext) return null;

  const target = Math.min(Math.max(0, lineTop - contextAbove), Math.max(0, maxScrollTop));
  return Math.abs(target - scrollTop) < 1 ? null : target;
}
