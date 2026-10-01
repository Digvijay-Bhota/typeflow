// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import { TypingArea } from "@/features/typing/components/TypingArea";
import React from "react";

describe("TypingArea — Mobile Input", () => {
  it("handles standard input events correctly", () => {
    const onKey = vi.fn();
    const onBackspace = vi.fn();
    const onStart = vi.fn();

    render(
      <TypingArea
        language="english"
        chars={[]}
        currentIndex={0}
        errorMap={{}}
        status="idle"
        onKey={onKey}
        onBackspace={onBackspace}
        onStart={onStart}
      />
    );

    const input = screen.getByRole("textbox").querySelector("input")!;

    // Normal text insertion
    const inputEvent = createEvent.input(input, { target: { value: "h" } });
    Object.defineProperty(inputEvent, "data", { value: "h" });
    Object.defineProperty(inputEvent, "inputType", { value: "insertText" });
    fireEvent(input, inputEvent);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledWith("h");
    expect(input.value).toBe("");

    // Multiple characters at once (e.g., from suggestion/autocomplete)
    const multiInputEvent = createEvent.input(input, { target: { value: "ello" } });
    Object.defineProperty(multiInputEvent, "data", { value: "ello" });
    Object.defineProperty(multiInputEvent, "inputType", { value: "insertText" });
    fireEvent(input, multiInputEvent);

    expect(onKey).toHaveBeenCalledWith("e");
    expect(onKey).toHaveBeenCalledWith("l");
    expect(onKey).toHaveBeenCalledWith("l");
    expect(onKey).toHaveBeenCalledWith("o");
    expect(input.value).toBe("");

    // Backspace
    const backspaceEvent = createEvent.input(input, { target: { value: "" } });
    Object.defineProperty(backspaceEvent, "data", { value: null });
    Object.defineProperty(backspaceEvent, "inputType", {
      value: "deleteContentBackward",
    });
    fireEvent(input, backspaceEvent);

    expect(onBackspace).toHaveBeenCalledTimes(1);
  });

  it("handles composition events correctly", () => {
    const onKey = vi.fn();

    render(
      <TypingArea
        language="english"
        chars={[]}
        currentIndex={0}
        errorMap={{}}
        status="active"
        onKey={onKey}
        onBackspace={vi.fn()}
      />
    );

    const input = screen.getByRole("textbox").querySelector("input")!;

    // Start composition
    fireEvent.compositionStart(input);

    // Intermediate input (should be ignored while composing)
    const intermediateInput = createEvent.input(input, { target: { value: "a" } });
    Object.defineProperty(intermediateInput, "data", { value: "a" });
    Object.defineProperty(intermediateInput, "inputType", {
      value: "insertCompositionText",
    });
    fireEvent(input, intermediateInput);

    expect(onKey).not.toHaveBeenCalled();

    // End composition
    const compEndEvent = createEvent.compositionEnd(input);
    Object.defineProperty(compEndEvent, "data", { value: "á" });
    fireEvent(input, compEndEvent);

    expect(onKey).toHaveBeenCalledWith("á");
    expect(input.value).toBe("");
  });
});
