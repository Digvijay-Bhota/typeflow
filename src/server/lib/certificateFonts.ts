// fontkit's Indic shaper is compiled against a global regeneratorRuntime.
import "regenerator-runtime/runtime";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

export { fontkit };

/**
 * Bundled with the app (OFL 1.1, see OFL.txt next to it) and never fetched at
 * runtime. next.config.ts traces it into the functions that render
 * certificates; keep the two paths in sync.
 */
export const DEVANAGARI_FONT_FILE =
  "src/server/assets/fonts/NotoSansDevanagari-Regular.ttf";
/** Fixed subset font name, instead of pdf-lib's generated suffix. */
export const DEVANAGARI_FONT_NAME = "NotoSansDevanagari-Regular";

export type DevanagariFont = {
  bytes: Uint8Array;
  covers(codePoint: number): boolean;
  /** Same measure pdf-lib uses when drawing: shaped glyph advances. */
  widthOfTextAtSize(text: string, size: number): number;
};

let cached: Promise<DevanagariFont> | undefined;

async function load(): Promise<DevanagariFont> {
  const bytes = new Uint8Array(
    await readFile(path.join(process.cwd(), DEVANAGARI_FONT_FILE))
  );
  const font = fontkit.create(bytes);
  const codePoints = new Set(font.characterSet);
  return {
    bytes,
    covers: (codePoint) => codePoints.has(codePoint),
    widthOfTextAtSize: (text, size) => {
      const advance = font
        .layout(text)
        .glyphs.reduce((sum, g) => sum + g.advanceWidth, 0);
      return (advance * size) / font.unitsPerEm;
    },
  };
}

/** Loads (once per instance) the font; a failed load is retried next time. */
export function loadDevanagariFont(): Promise<DevanagariFont> {
  cached ??= load().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
