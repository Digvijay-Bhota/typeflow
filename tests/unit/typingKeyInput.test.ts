// @vitest-environment happy-dom
/**
 * Typing area key handling: which modified keys are typed.
 *
 * Regression: every keydown with Ctrl or Alt held was dropped as a shortcut.
 * AltGr — reported by Windows as Ctrl+Alt — types @ { } [ ] \ | on most
 * European layouts, and Option types characters on a Mac, so those typists
 * could not enter characters their passage required.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { TypingArea } from "@/features/typing/components/TypingArea";
import { detectApplePlatform, isShortcutKey } from "@/features/typing/lib/keyInput";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
  altGraph = false
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
  getModifierState: (m: string) => altGraph && m === "AltGraph",
});

describe("isShortcutKey", () => {
  it("types unmodified keys", () => {
    expect(isShortcutKey(key("a"), false)).toBe(false);
    expect(isShortcutKey(key("Backspace"), false)).toBe(false);
  });

  it("leaves Ctrl and Cmd shortcuts to the browser", () => {
    expect(isShortcutKey(key("c", { ctrlKey: true }), false)).toBe(true);
    expect(isShortcutKey(key("v", { metaKey: true }), true)).toBe(true);
    expect(isShortcutKey(key("@", { metaKey: true, altKey: true }), true)).toBe(true);
  });

  it("types AltGr characters, exposed as the AltGraph state", () => {
    // A genuine AltGr keystroke has AltGraph modifier state
    expect(isShortcutKey(key("{", { altKey: true }, true), false)).toBe(false);
    expect(isShortcutKey(key("\\", {}, true), false)).toBe(false);
    expect(isShortcutKey(key("@", { ctrlKey: true, altKey: true }, true), false)).toBe(
      false
    );
  });

  it("leaves physical Ctrl+Alt shortcuts to the browser", () => {
    // Ctrl+Alt without AltGraph is a shortcut
    expect(isShortcutKey(key("c", { ctrlKey: true, altKey: true }), false)).toBe(true);
  });

  it("types Option characters on Apple platforms only", () => {
    expect(isShortcutKey(key("@", { altKey: true }), true)).toBe(false);
    expect(isShortcutKey(key("f", { altKey: true }), false)).toBe(true);
  });

  it("keeps modified non-printable keys as shortcuts", () => {
    expect(isShortcutKey(key("Backspace", { altKey: true }), true)).toBe(true);
    expect(isShortcutKey(key("Backspace", { ctrlKey: true }), false)).toBe(true);
    expect(isShortcutKey(key("Enter", { ctrlKey: true, altKey: true }), false)).toBe(
      true
    );
  });
});

describe("detectApplePlatform", () => {
  it("reads the platform from userAgentData or navigator.platform", () => {
    vi.stubGlobal("navigator", { userAgentData: { platform: "macOS" } });
    expect(detectApplePlatform()).toBe(true);
    vi.stubGlobal("navigator", { platform: "iPhone" });
    expect(detectApplePlatform()).toBe(true);
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(detectApplePlatform()).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(detectApplePlatform()).toBe(false);
  });
});

describe("TypingArea — modified keys", () => {
  function renderArea() {
    const onKey = vi.fn<(c: string) => void>();
    const onBackspace = vi.fn();
    render(
      createElement(TypingArea, {
        chars: "a@{".split(""),
        currentIndex: 0,
        errorMap: {},
        status: "active",
        onKey,
        onBackspace,
      })
    );
    return { textbox: screen.getByRole("textbox"), onKey, onBackspace };
  }

  it("types a Windows AltGr character (Ctrl+Alt)", () => {
    const { textbox, onKey } = renderArea();
    fireEvent.keyDown(textbox, { key: "@", ctrlKey: true, altKey: true });
    expect(onKey).toHaveBeenCalledWith("@");
  });

  it("still ignores Ctrl and Cmd shortcuts", () => {
    const { textbox, onKey, onBackspace } = renderArea();
    fireEvent.keyDown(textbox, { key: "c", ctrlKey: true });
    fireEvent.keyDown(textbox, { key: "a", metaKey: true });
    fireEvent.keyDown(textbox, { key: "Backspace", ctrlKey: true });
    expect(onKey).not.toHaveBeenCalled();
    expect(onBackspace).not.toHaveBeenCalled();
  });
});
