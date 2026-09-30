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

  function dispatchKey(node: HTMLElement, key: string, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}, altGraph = false) {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, ...mods });
    Object.defineProperty(ev, "getModifierState", {
      value: (mod: string) => mod === "AltGraph" && altGraph,
    });
    fireEvent(node, ev);
  }

  it("types a genuine AltGraph printable character", () => {
    const { textbox, onKey } = renderArea();
    // Genuine AltGraph: ctrl=true, alt=true, getModifierState("AltGraph")=true
    dispatchKey(textbox, "@", { ctrlKey: true, altKey: true }, true);
    expect(onKey).toHaveBeenCalledWith("@");
  });

  it("ignores a physical Ctrl+Alt shortcut without AltGraph", () => {
    const { textbox, onKey, onBackspace } = renderArea();
    // Physical shortcut: ctrl=true, alt=true, getModifierState("AltGraph")=false
    dispatchKey(textbox, "c", { ctrlKey: true, altKey: true }, false);
    expect(onKey).not.toHaveBeenCalled();
    expect(onBackspace).not.toHaveBeenCalled();
  });

  it("still ignores Ctrl and Cmd shortcuts", () => {
    const { textbox, onKey, onBackspace } = renderArea();
    dispatchKey(textbox, "c", { ctrlKey: true }, false);
    dispatchKey(textbox, "a", { metaKey: true }, false);
    dispatchKey(textbox, "Backspace", { ctrlKey: true }, false);
    expect(onKey).not.toHaveBeenCalled();
    expect(onBackspace).not.toHaveBeenCalled();
  });
});
