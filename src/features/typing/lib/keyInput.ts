/**
 * Keyboard input classification for the typing area.
 *
 * Pure functions: the typing area passes in the keydown event's key and
 * modifier flags, so the rules are testable without a browser.
 */

export interface KeyModifiers {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  getModifierState?: ((key: "AltGraph") => boolean) | undefined;
}

/**
 * Whether a keydown is a shortcut left to the browser rather than typing.
 *
 * Rules:
 * - No modifier held → typing.
 * - Cmd (meta) → shortcut.
 * - A modifier with a non-printable key (Tab, Enter, Backspace, arrows…)
 *   → shortcut.
 * - AltGr + a printable key → typing. Windows reports AltGr as Ctrl+Alt, and
 *   browsers expose it as the "AltGraph" modifier state; it types characters
 *   such as @ { } [ ] \ | on most European layouts.
 * - Option + a printable key on Apple platforms → typing (Option types
 *   characters there, e.g. @ is Option+L on a German Mac). Elsewhere Alt is a
 *   menu accelerator → shortcut.
 * - Ctrl + a printable key → shortcut.
 *
 * @param e The keydown event (or its key and modifier flags)
 * @param isApplePlatform Whether the browser runs on macOS / iOS
 * @returns true when the key must not be typed
 */
export function isShortcutKey(e: KeyModifiers, isApplePlatform: boolean): boolean {
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return false;
  if (e.metaKey) return true;
  if (e.key.length !== 1) return true;

  const altGraph = e.getModifierState?.("AltGraph") === true;
  if (altGraph) return false;
  if (e.altKey && !e.ctrlKey) return !isApplePlatform;
  return true;
}

/**
 * Whether the browser runs on an Apple platform, where Option types
 * characters. False outside a browser.
 */
export function detectApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
