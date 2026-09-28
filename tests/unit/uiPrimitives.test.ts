/**
 * UI primitives and their first consumers (Phase 8.1): rendered to static
 * markup and checked for the accessibility contracts they promise (focusable
 * controls, busy state, label/hint/error wiring, screen-reader text, one <h1>,
 * no nested <main>), plus the global focus and reduced-motion CSS.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));

import {
  Badge,
  Button,
  ButtonLink,
  buttonVariants,
  Card,
  CardTitle,
  cn,
  Container,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Spinner,
  StatCard,
  Textarea,
  VisuallyHidden,
} from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("cn", () => {
  it("resolves conflicts on the custom scales instead of dropping or keeping both", () => {
    expect(cn("text-title text-foreground")).toBe("text-title text-foreground");
    expect(cn("rounded-control", "rounded-full")).toBe("rounded-full");
    expect(cn("shadow-card", "shadow-overlay")).toBe("shadow-overlay");
    expect(cn("max-w-page", "max-w-narrow")).toBe("max-w-narrow");
    expect(cn("px-4", false && "px-8", undefined, "py-2")).toBe("px-4 py-2");
  });
});

describe("Button", () => {
  it("is a real button, type=button by default, with the primary look", () => {
    const out = html(h(Button, null, "Save"));
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain("bg-accent");
    expect(out).toContain("text-accent-foreground");
    expect(out).toContain(">Save</button>");
  });

  it("keeps an explicit submit type", () => {
    expect(html(h(Button, { type: "submit" }, "Go"))).toContain('type="submit"');
  });

  it.each([
    ["secondary", "border-border-strong"],
    ["ghost", "hover:bg-surface-muted"],
    ["danger", "text-danger-foreground"],
    ["link", "underline-offset-4"],
  ] as const)("%s variant", (variant, cls) => {
    expect(html(h(Button, { variant }, "x"))).toContain(cls);
  });

  it.each([
    ["sm", "h-8"],
    ["md", "h-10"],
    ["lg", "h-12"],
  ] as const)("%s size", (size, cls) => {
    expect(html(h(Button, { size }, "x"))).toContain(cls);
  });

  it("loading: disabled, aria-busy, spinner hidden from AT, label kept", () => {
    const out = html(h(Button, { loading: true }, "Pay now"));
    expect(out).toContain("disabled");
    expect(out).toContain('aria-busy="true"');
    const svg = out.match(/<svg[^>]*>/)?.[0] ?? "";
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain("animate-spin");
    expect(out).toContain("Pay now");
  });

  it("is not marked busy when idle", () => {
    expect(html(h(Button, null, "x"))).not.toContain("aria-busy");
  });

  it("link variant has no fixed height or padding; className overrides merge", () => {
    expect(buttonVariants({ variant: "link" })).not.toMatch(/\bh-10\b|\bpx-4\b/);
    expect(buttonVariants({ className: "rounded-full" })).not.toContain(
      "rounded-control"
    );
  });

  it("ButtonLink renders a link with the button look", () => {
    const out = html(
      h(ButtonLink, { href: "/pricing", variant: "secondary" }, "Pricing")
    );
    expect(out).toMatch(/^<a href="\/pricing"/);
    expect(out).toContain("border-border-strong");
  });
});

describe("form controls", () => {
  it("Input and Textarea use the strong control boundary and follow aria-invalid", () => {
    for (const el of [h(Input, { id: "a" }), h(Textarea, { id: "b" })]) {
      const out = html(el);
      expect(out).toContain("border-border-strong");
      expect(out).toContain("aria-invalid:border-danger");
    }
    expect(html(h(Input, null))).toContain('type="text"');
  });

  it("Field wires label, hint and error to the control", () => {
    const out = html(
      h(Field, {
        id: "email",
        label: "Email",
        hint: "We never share it.",
        error: "Enter a valid email.",
        required: true,
        children: (control) => h(Input, { type: "email", required: true, ...control }),
      })
    );
    expect(out).toContain(
      '<label class="text-foreground text-sm font-medium" for="email">'
    );
    expect(out).toContain('id="email"');
    expect(out).toContain('aria-describedby="email-hint email-error"');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('id="email-hint"');
    expect(out).toContain('id="email-error"');
    expect(out).toMatch(/<span aria-hidden="true"[^>]*>\*<\/span>/);
  });

  it("Field without hint or error adds no aria attributes", () => {
    const out = html(
      h(Field, { id: "name", label: "Name", children: (c) => h(Input, c) })
    );
    // Attributes, not the aria-invalid: variant inside the Input's class list.
    expect(out).not.toContain('aria-describedby="');
    expect(out).not.toContain('aria-invalid="');
  });
});

describe("feedback and layout primitives", () => {
  it("Spinner with a label is a status with screen-reader text; without, it is hidden", () => {
    const labelled = html(h(Spinner, { label: "Loading results" }));
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('<span class="sr-only">Loading results</span>');
    const bare = html(h(Spinner));
    expect(bare).not.toContain("role=");
    expect(bare).toContain('aria-hidden="true"');
    expect(bare).toContain("motion-reduce:animate-none");
  });

  it("Skeleton is hidden from assistive technology and respects reduced motion", () => {
    const out = html(h(Skeleton, { className: "h-4 w-32" }));
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("motion-reduce:animate-none");
  });

  it("VisuallyHidden is sr-only", () => {
    expect(html(h(VisuallyHidden, null, "x"))).toBe('<span class="sr-only">x</span>');
  });

  it.each([
    ["accent", "text-accent"],
    ["success", "text-success"],
    ["warning", "text-warning"],
    ["danger", "text-danger"],
    ["neutral", "text-secondary"],
  ] as const)("Badge %s tone", (tone, cls) => {
    expect(html(h(Badge, { tone }, "New"))).toContain(cls);
  });

  it("Card and CardTitle (h3 by default, h2 on request)", () => {
    expect(html(h(Card, null, "x"))).toContain("rounded-card");
    expect(html(h(CardTitle, null, "T"))).toMatch(/^<h3/);
    expect(html(h(CardTitle, { as: "h2" }, "T"))).toMatch(/^<h2/);
  });

  it("Container widths", () => {
    expect(html(h(Container, null, "x"))).toContain("max-w-page");
    expect(html(h(Container, { size: "narrow" }, "x"))).toContain("max-w-narrow");
  });

  it("PageHeader renders exactly one h1 with description and actions", () => {
    const out = html(
      h(PageHeader, {
        title: "History",
        description: "Every test you have taken.",
        actions: h(Button, null, "Export"),
      })
    );
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).toContain("Every test you have taken.");
    expect(out).toContain("Export");
  });

  it("StatCard reads label and value together (description list)", () => {
    const out = html(h(StatCard, { label: "Best WPM", value: 92, hint: "last 30 days" }));
    expect(out).toMatch(/<dl[\s\S]*<dt[\s\S]*Best WPM[\s\S]*<dd[^>]*>92<\/dd>/);
    expect(out).toContain("tabular-nums");
  });
});

describe("first consumers", () => {
  it("404 page: one h1, a link home, no nested <main>, no undefined classes", () => {
    const out = html(h(NotFound));
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).not.toContain("<main");
    expect(out).toMatch(/<a href="\/"[^>]*>Back to TypeFlow<\/a>/);
    expect(out).not.toContain("tf-neutral");
  });

  it("error page: one h1, retry button, home link, digest, no nested <main>", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    const out = html(h(ErrorPage, { error, reset: () => {} }));
    expect(count(out, /<h1/g)).toBe(1);
    expect(out).not.toContain("<main");
    expect(out).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
    expect(out).toMatch(/<a href="\/"[^>]*>Go home<\/a>/);
    expect(out).toContain("Error ID: abc123");
    expect(out).not.toContain("tf-neutral");
    expect(out).not.toContain("boom"); // the message is logged, not shown
  });

  it("EmptyState: h2, decorative icon hidden, action link; no link without href", () => {
    const out = html(
      h(EmptyState, { title: "No tests yet", description: "Take your first test." })
    );
    expect(out).toContain(
      '<h2 class="text-xl font-semibold tracking-tight">No tests yet</h2>'
    );
    expect(out).toMatch(/<a href="\/"[^>]*>Start Typing Test/);
    expect(count(out, /aria-hidden="true"/g)).toBeGreaterThanOrEqual(2);
    const noAction = html(
      h(EmptyState, { title: "t", description: "d", actionHref: "" })
    );
    expect(noAction).not.toContain("<a ");
  });

  it("consumer sources no longer use undefined tf-neutral classes or a second <main>", () => {
    for (const file of [
      "src/app/error.tsx",
      "src/app/not-found.tsx",
      "src/components/EmptyState.tsx",
    ]) {
      // Code only: the files explain in comments why they have no <main>.
      const src = readFileSync(join(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src).not.toContain("tf-neutral");
      expect(src).not.toMatch(/<main[\s>]/);
    }
  });
});

describe("global CSS", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("draws a visible keyboard focus ring for every focusable element", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--ring\);/);
  });

  it("honours prefers-reduced-motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important;[\s\S]*transition-duration: 0\.01ms !important;/
    );
  });

  it("builds the font stacks from next/font's variables", () => {
    expect(css).toContain("--font-sans: var(--font-inter)");
    expect(css).toContain("--font-mono:");
    expect(css).toContain("var(--font-jetbrains-mono)");
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('variable: "--font-inter"');
    expect(layout).toContain('variable: "--font-jetbrains-mono"');
  });
});
