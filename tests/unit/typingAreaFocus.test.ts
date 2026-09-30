// @vitest-environment happy-dom
/**
 * The typing area says when keystrokes will not land.
 *
 * Keystrokes only reach the test while the typing area has focus, and a
 * running test keeps its clock going when focus moves elsewhere. Previously
 * nothing showed that typing had stopped registering mid-test, and the idle
 * hint asked for a click even when the area already had focus.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { TypingArea } from "@/features/typing/components/TypingArea";
import type { EngineStatus } from "@/types/typing";

afterEach(() => {
  cleanup();
});

function renderArea(status: EngineStatus) {
  const props = {
    chars: "hello world".split(""),
    currentIndex: 0,
    errorMap: {},
    onKey: vi.fn(),
    onBackspace: vi.fn(),
  };
  const { rerender } = render(createElement(TypingArea, { ...props, status }));
  const textbox = screen.getByRole("textbox");
  return {
    textbox,
    setStatus: (s: EngineStatus) =>
      rerender(createElement(TypingArea, { ...props, status: s })),
  };
}

const overlay = () => screen.queryByTestId("typing-overlay")?.textContent ?? null;

describe("TypingArea — focus overlay", () => {
  it("asks for a click before the area has focus, and not once it has", () => {
    const { textbox } = renderArea("idle");
    expect(overlay()).toBe("Click to start typing");

    act(() => textbox.focus());
    expect(overlay()).toBe("Start typing");
  });

  it("shows nothing over a focused running test", () => {
    const { textbox, setStatus } = renderArea("idle");
    act(() => textbox.focus());
    setStatus("active");
    expect(overlay()).toBeNull();
  });

  it("says where to click when a running test loses focus", () => {
    const { textbox, setStatus } = renderArea("idle");
    act(() => textbox.focus());
    setStatus("active");

    act(() => textbox.blur());
    expect(overlay()).toBe("Click to continue typing");

    act(() => textbox.focus());
    expect(overlay()).toBeNull();
  });

  it("shows nothing over a completed test", () => {
    renderArea("completed");
    expect(overlay()).toBeNull();
  });
});
