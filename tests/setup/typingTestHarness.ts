import { createElement, type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { TypingTest } from "@/features/typing/components/TypingTest";

/**
 * Renders TypingTest and resolves with its typing area once the component is
 * ready for keystrokes: the session has loaded AND the engine has reset itself
 * for the session's passage.
 *
 * Why waiting for the textbox is not enough: the session arrives from an
 * async fetch outside act(), so React commits the typing area and schedules
 * useTypingEngine's passage-change effect (`useEffect(reset, [passage])`) as a
 * separate task. Typing as soon as the textbox appears races that task — and
 * React flushes pending effects before the render a keystroke triggers, i.e.
 * after the keystroke has already advanced the engine's refs. The reset then
 * returns the index to 0 and cancels the timer loop, so the rest of the
 * typing is scored against the wrong characters and timer expiry never fires.
 *
 * Re-rendering the same element inside act() (RTL's rerender) makes React
 * flush those pending effects before it starts that render (it always does
 * before new work), and then commits an identical tree: nothing re-fetches
 * and the passage effect does not run again.
 */
export async function renderReadyTypingTest(
  props: ComponentProps<typeof TypingTest>
): Promise<HTMLElement> {
  const element = createElement(TypingTest, props);
  const { rerender } = render(element);
  await screen.findByRole("textbox");
  rerender(element);
  return screen.getByRole("textbox");
}
