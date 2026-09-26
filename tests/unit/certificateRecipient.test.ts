import { describe, it, expect } from "vitest";
import {
  layoutRecipientLine,
  needsDevanagariFont,
  sanitizeRecipientName,
  RECIPIENT_FALLBACK_TEXT,
  RECIPIENT_FONT_SIZE,
  RECIPIENT_LABEL,
  RECIPIENT_MAX_GRAPHEMES,
  RECIPIENT_MAX_WIDTH,
  RECIPIENT_MIN_FONT_SIZE,
  type RecipientCoverage,
  type RecipientLine,
  type RecipientMeasure,
} from "@/lib/certificateRecipient";

// Stand-ins for the real fonts: "latin" draws Latin-1 plus the ellipsis
// (like Helvetica/WinAnsi), "devanagari" draws Devanagari, ASCII and the
// joiners (like Noto Sans Devanagari). Every code point is 0.5 em wide.
const coverage: RecipientCoverage = {
  latin: (cp) => cp <= 0xff || cp === 0x2026,
  devanagari: (cp) =>
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0x0900 && cp <= 0x097f) ||
    cp === 0x200c ||
    cp === 0x200d,
};
const measure: RecipientMeasure = (_font, text, size) =>
  Array.from(text).length * size * 0.5;

const layout = (name: string, m: RecipientMeasure = measure) =>
  layoutRecipientLine(name, coverage, m);
const nameText = (line: RecipientLine) =>
  line.runs
    .map((r) => r.text)
    .join("")
    .slice(RECIPIENT_LABEL.length);
const width = (line: RecipientLine) =>
  line.runs.reduce((sum, r) => sum + measure(r.font, r.text, line.size), 0);
const graphemes = (text: string) =>
  Array.from(
    new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text),
    (s) => s.segment
  );

describe("sanitizeRecipientName", () => {
  it("leaves ordinary Latin names untouched", () => {
    for (const name of [
      "User 1",
      "Anonymous Typist",
      "José Müller-Øster",
      "Anne-Marie O'Neil, Jr.",
    ]) {
      expect(sanitizeRecipientName(name)).toBe(name);
    }
  });

  it("NFC-normalizes decomposed accents", () => {
    expect(sanitizeRecipientName("José")).toBe("José");
  });

  it("removes emoji, modifiers, flags, keycaps and ZWJ sequences", () => {
    expect(sanitizeRecipientName("Sam 🚀 Lee")).toBe("Sam Lee");
    expect(sanitizeRecipientName("👍🏽 Ana")).toBe("Ana");
    expect(sanitizeRecipientName("Ravi 🇮🇳")).toBe("Ravi");
    expect(sanitizeRecipientName("Team 1️⃣")).toBe("Team 1");
    expect(sanitizeRecipientName("Kim 👨‍👩‍👧")).toBe("Kim");
    expect(sanitizeRecipientName("❤️")).toBe("");
  });

  it("keeps ©, ® and ™, which Helvetica can draw", () => {
    expect(sanitizeRecipientName("Acme™ ©®")).toBe("Acme™ ©®");
  });

  it("turns control characters into spaces and collapses whitespace", () => {
    expect(sanitizeRecipientName("  Ada\tLovelace\n\nKing  ")).toBe("Ada Lovelace King");
    expect(sanitizeRecipientName("Ada  Lovelace")).toBe("Ada Lovelace");
  });

  it("removes bidi controls and invisible format characters", () => {
    expect(sanitizeRecipientName("‮Ada​ Love­lace﻿")).toBe("Ada Lovelace");
  });

  it("keeps ZWJ/ZWNJ only after Devanagari", () => {
    expect(sanitizeRecipientName("क्‍ष")).toBe("क्‍ष");
    expect(sanitizeRecipientName("क्‌ष")).toBe("क्‌ष");
    expect(sanitizeRecipientName("A‍B‌")).toBe("AB");
    expect(sanitizeRecipientName("‍क")).toBe("क");
  });
});

describe("needsDevanagariFont", () => {
  it("is true only for names with Devanagari text", () => {
    expect(needsDevanagariFont("प्रिया शर्मा")).toBe(true);
    expect(needsDevanagariFont("Priya (प्रिया)")).toBe(true);
    expect(needsDevanagariFont("Priya Sharma")).toBe(false);
    expect(needsDevanagariFont("李明")).toBe(false);
    expect(needsDevanagariFont("🚀")).toBe(false);
  });
});

describe("layoutRecipientLine", () => {
  it("draws a Latin name that fits as one unchanged run at the normal size", () => {
    expect(layout("Ada Lovelace")).toEqual({
      runs: [{ font: "latin", text: "Recipient: Ada Lovelace" }],
      size: RECIPIENT_FONT_SIZE,
      truncated: false,
      fallback: false,
    });
  });

  it("draws Hindi in the Devanagari font, spaces included", () => {
    expect(layout("प्रिया शर्मा")).toEqual({
      runs: [
        { font: "latin", text: RECIPIENT_LABEL },
        { font: "devanagari", text: "प्रिया शर्मा" },
      ],
      size: RECIPIENT_FONT_SIZE,
      truncated: false,
      fallback: false,
    });
  });

  it("splits mixed Latin and Devanagari names into alternating runs", () => {
    expect(layout("Priya (प्रिया) Sharma").runs).toEqual([
      { font: "latin", text: "Recipient: Priya (" },
      { font: "devanagari", text: "प्रिया) " },
      { font: "latin", text: "Sharma" },
    ]);
  });

  it("keeps punctuation-heavy Latin names in one run", () => {
    const line = layout("O'Brien-Smith, Jr. (Dr.)");
    expect(line.runs).toEqual([
      { font: "latin", text: "Recipient: O'Brien-Smith, Jr. (Dr.)" },
    ]);
  });

  it("replaces a name with an unsupported script by the fallback text, whole", () => {
    for (const name of ["李明", "Ming 李", "प्रिया 李", "Ελένη"]) {
      expect(layout(name)).toEqual({
        runs: [{ font: "latin", text: RECIPIENT_LABEL + RECIPIENT_FALLBACK_TEXT }],
        size: RECIPIENT_FONT_SIZE,
        truncated: false,
        fallback: true,
      });
    }
  });

  it("uses the fallback text when nothing drawable is left", () => {
    expect(layout("🚀🔥").fallback).toBe(true);
    expect(layout("").fallback).toBe(true);
    expect(nameText(layout("​"))).toBe(RECIPIENT_FALLBACK_TEXT);
  });

  it("drops emoji and keeps the rest of the name", () => {
    expect(layout("Sam 🚀 Lee")).toEqual(layout("Sam Lee"));
  });

  it("shrinks a slightly long name instead of cutting it", () => {
    // 11 + 30 = 41 code points: 41 * 18 * 0.5 = 369 > 340, but fits at 16.
    const line = layout("A".repeat(30));
    expect(line.truncated).toBe(false);
    expect(line.size).toBe(16);
    expect(nameText(line)).toBe("A".repeat(30));
    expect(width(line)).toBeLessThanOrEqual(RECIPIENT_MAX_WIDTH);
  });

  it("cuts a name too long even at the minimum size, ending it with an ellipsis", () => {
    const name = "Wolfgang Amadeus Theophilus Mozart ".repeat(4).trim();
    const line = layout(name);
    expect(line).toMatchObject({
      size: RECIPIENT_MIN_FONT_SIZE,
      truncated: true,
      fallback: false,
    });
    expect(width(line)).toBeLessThanOrEqual(RECIPIENT_MAX_WIDTH);
    const shown = nameText(line);
    expect(shown.endsWith("…")).toBe(true);
    expect(name.startsWith(shown.slice(0, -1))).toBe(true);
    expect(shown).not.toMatch(/\s…$/);
    // The longest prefix that fits: one more character would not.
    const kept = shown.length - 1;
    expect(RECIPIENT_LABEL.length + kept + 2).toBeGreaterThan(
      RECIPIENT_MAX_WIDTH / (RECIPIENT_MIN_FONT_SIZE * 0.5)
    );
  });

  it("cuts Devanagari only at grapheme boundaries", () => {
    const name = "क्षत्रिय ".repeat(30).trim();
    const line = layout(name);
    expect(line.truncated).toBe(true);
    const shown = nameText(line).slice(0, -1);
    const all = graphemes(name);
    const kept = graphemes(shown);
    expect(kept).toEqual(all.slice(0, kept.length));
    expect(line.runs.at(-1)).toEqual({ font: "latin", text: "…" });
  });

  it("bounds the work on very long input", () => {
    const line = layout("i".repeat(RECIPIENT_MAX_GRAPHEMES * 10), () => 0);
    expect(line.truncated).toBe(true);
    expect(nameText(line)).toBe("i".repeat(RECIPIENT_MAX_GRAPHEMES) + "…");
  });

  it("falls back to the label and an ellipsis if nothing of the name fits", () => {
    const wide: RecipientMeasure = (_f, text, size) =>
      text === RECIPIENT_LABEL ? 300 : text.length * size * 5;
    expect(layout("Ada", wide)).toEqual({
      runs: [{ font: "latin", text: "Recipient: …" }],
      size: RECIPIENT_MIN_FONT_SIZE,
      truncated: true,
      fallback: false,
    });
  });

  it("is deterministic", () => {
    for (const name of ["प्रिया शर्मा", "李明", "W".repeat(100), "Sam 🚀 Lee"]) {
      expect(layout(name)).toEqual(layout(name));
    }
  });
});
