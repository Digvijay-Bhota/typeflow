/**
 * WCAG contrast of the semantic colour tokens (Phase 8.1).
 *
 * Parses the real token definitions in src/app/globals.css, builds the
 * effective token set for each theme the app can render (light/dark × default,
 * code, certificate and pro areas, in CSS cascade order), converts OKLCH to
 * sRGB and checks every pairing the UI relies on:
 *
 *  - text (4.5:1): foreground, secondary, muted, accent, success, warning,
 *    danger and info on every page and card background;
 *  - filled controls (4.5:1): accent-foreground on accent, danger-foreground
 *    on danger;
 *  - tinted chips (4.5:1): accent on accent-soft, and each status colour on
 *    its own 10% tint (badges, the typing test's error highlight);
 *  - control boundaries and the focus ring (3:1, WCAG 1.4.11): border-strong
 *    and ring on every background.
 *
 * Decorative separators (--border) are exempt by design and not checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

type Tokens = Record<string, string>;

/** Declarations of the innermost block whose selector is exactly `selector`. */
function block(selector: string): Tokens {
  const tokens: Tokens = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== selector) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[d[1]!] = d[2]!.trim();
    }
  }
  return tokens;
}

const root = block(":root");
const dark = block(".dark");
const areas = ["code", "certificate", "pro"] as const;

/** Effective tokens for a theme, merged in cascade order. */
function theme(mode: "light" | "dark", area: "default" | (typeof areas)[number]) {
  const layers: Tokens[] = [root];
  if (mode === "dark") layers.push(dark);
  if (area !== "default") {
    layers.push(block(`.theme-${area}`));
    if (mode === "dark") layers.push(block(`.dark .theme-${area}`));
  }
  return Object.assign({}, ...layers) as Tokens;
}

type Rgb = [number, number, number]; // linear-light sRGB, 0..1

function resolve(tokens: Tokens, name: string, depth = 0): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Token ${name} is not defined`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    if (depth > 5) throw new Error(`Token ${name}: var() cycle`);
    return resolve(tokens, ref[1]!, depth + 1);
  }
  return value;
}

/** OKLCH → linear sRGB (clamped to the gamut). */
function color(tokens: Tokens, name: string): Rgb {
  const value = resolve(tokens, name);
  const m = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`Token ${name}: expected oklch(L% C H), got ${value}`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

const toGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** `top` at `alpha` over `bottom`, composited in gamma-encoded sRGB as browsers do. */
function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return top.map((t, i) =>
    toLinear(alpha * toGamma(t) + (1 - alpha) * toGamma(bottom[i]!))
  ) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function contrast(x: Rgb, y: Rgb): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const BACKGROUNDS = [
  "--background",
  "--surface",
  "--surface-elevated",
  "--surface-muted",
];
const TEXT = [
  "--foreground",
  "--text-secondary",
  "--text-muted",
  "--accent",
  "--success",
  "--warning",
  "--danger",
  "--info",
];
const TINTED = ["--accent", "--success", "--warning", "--danger"];

const themes = (["light", "dark"] as const).flatMap((mode) =>
  (["default", ...areas] as const).map((area) => ({ mode, area }))
);

describe.each(themes)("$mode theme, $area area", ({ mode, area }) => {
  const t = theme(mode, area);
  const c = (name: string) => color(t, name);

  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg] as const)))(
    "text %s on %s ≥ 4.5:1",
    (fg, bg) => {
      expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5);
    }
  );

  it.each([
    ["--accent-foreground", "--accent"],
    ["--danger-foreground", "--danger"],
    ["--accent", "--accent-soft"],
  ])("filled/soft %s on %s ≥ 4.5:1", (fg, bg) => {
    expect(contrast(c(fg), c(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(
    TINTED.flatMap((tone) => ["--background", "--surface"].map((bg) => [tone, bg]))
  )("%s on its own 10%% tint over %s ≥ 4.5:1", (tone, bg) => {
    const tint = over(c(tone), 0.1, c(bg));
    expect(contrast(c(tone), tint)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(
    ["--border-strong", "--ring"].flatMap((ui) =>
      ["--background", "--surface", "--surface-elevated"].map((bg) => [ui, bg])
    )
  )("control boundary %s on %s ≥ 3:1", (ui, bg) => {
    expect(contrast(c(ui), c(bg))).toBeGreaterThanOrEqual(3);
  });
});

describe("token definitions", () => {
  it("every colour the Tailwind theme exposes exists in every theme", () => {
    const exposed = [...css.matchAll(/--color-[\w-]+:\s*var\((--[\w-]+)\)/g)].map(
      (m) => m[1]!
    );
    expect(exposed.length).toBeGreaterThan(10);
    for (const { mode, area } of themes) {
      const t = theme(mode, area);
      for (const name of exposed) expect(() => resolve(t, name)).not.toThrow();
    }
  });

  it("parses the area and dark blocks (guards against a silent parser miss)", () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    for (const area of areas) {
      expect(block(`.theme-${area}`)["--accent"]).toMatch(/^oklch/);
      expect(block(`.dark .theme-${area}`)["--accent"]).toMatch(/^oklch/);
    }
  });

  it("contrast maths matches known WCAG values", () => {
    const white: Rgb = [1, 1, 1];
    const black: Rgb = [0, 0, 0];
    expect(contrast(white, black)).toBeCloseTo(21, 5);
    expect(contrast(white, white)).toBeCloseTo(1, 5);
  });
});
