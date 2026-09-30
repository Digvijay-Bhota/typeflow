import { test, expect } from "@playwright/test";

test.describe("Typing Input", () => {
  test("leaves physical Ctrl+Alt shortcuts alone (AltGr simulation documented)", async ({
    page,
  }) => {
    // Go to the main typing page where the engine mounts
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Ensure the app loads
    const typingArea = page.getByRole("textbox");
    await expect(typingArea).toBeVisible();

    // Focus the typing area
    await typingArea.focus();

    // The first character in the passage has a stable DOM index.
    // We select it specifically by structural position to avoid dynamic resolution bugs.
    const firstChar = page
      .locator('[data-testid="typing-viewport"] span.relative.inline')
      .nth(0);

    // Initially, it should be the active character
    await expect(firstChar).toHaveClass(/bg-surface-elevated\/50/);

    // Get the initial active character's text (e.g. 't' or 'T')
    const initialText = await firstChar.textContent();
    expect(initialText).toBeTruthy();

    // 1. Assert physical Ctrl+Alt+C shortcut is NOT inserted as typed character
    await page.keyboard.press("Control+Alt+c");

    // The first character should STILL be active, and its text unchanged, because the keystroke was ignored
    const newText = await firstChar.textContent();
    expect(newText).toBe(initialText);
    await expect(firstChar).toHaveClass(/bg-surface-elevated\/50/);

    // 2. Genuine AltGraph simulation assertion
    // Since Playwright headless (en-US) doesn't natively map AltGraph to a printable key,
    // we simulate the genuine browser event by dispatching a KeyboardEvent with getModifierState mocked.
    // This proves that the AltGraph-modified printable event reaches the typing input path
    // rather than being classified as a shortcut.
    await typingArea.evaluate((node) => {
      const event = new KeyboardEvent("keydown", {
        key: "@",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, "getModifierState", {
        value: (modifier: string) => modifier === "AltGraph",
      });
      node.dispatchEvent(event);
    });

    // The first character should NO LONGER be active, meaning the engine processed the keystroke
    // rather than dropping it as a shortcut.
    await expect(firstChar).not.toHaveClass(/bg-surface-elevated\/50/);
  });
});
