// @vitest-environment happy-dom
/**
 * The application shell (Phase 8.2): navigation targets exist, current-page
 * marking, the mobile menu's keyboard/focus/scroll behaviour, accessible names
 * of icon-only controls, the skip link and the URL-derived area theme.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/", theme: "light", setTheme: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: nav.theme, setTheme: nav.setTheme }),
}));
vi.mock("@/app/(auth)/actions", () => ({ logout: vi.fn() }));

import { MobileNav } from "@/components/shell/MobileNav";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { DashboardNav } from "@/components/shell/DashboardNav";
import { SkipLink } from "@/components/shell/SkipLink";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import {
  DASHBOARD_NAV,
  FOOTER_NAV,
  PRIMARY_NAV,
  isCurrent,
} from "@/components/shell/navigation";
import { experienceThemeForPath } from "@/components/providers/ExperienceProvider";
import { ALLOWED_SEO_ROUTES } from "@/app/(seo)/[seoSlug]/seoConfig";

beforeEach(() => {
  nav.pathname = "/";
  nav.theme = "light";
  nav.setTheme.mockClear();
});
afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = "";
});

// ---------------------------------------------------------------------------
// Every destination is a real route
// ---------------------------------------------------------------------------

const APP = join(process.cwd(), "src/app");

/** Route patterns of every page.tsx, route groups removed. */
function routePatterns(dir = APP): string[][] {
  const out: string[][] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routePatterns(full));
    else if (name === "page.tsx") {
      out.push(
        relative(APP, dir)
          .split(sep)
          .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
      );
    }
  }
  return out;
}

function routeExists(href: string): boolean {
  // next.config.ts rewrite: /code/:language → /:language-typing-test
  const code = href.match(/^\/code\/([a-z]+)$/);
  if (code) return routeExists(`/${code[1]}-typing-test`);
  const segments = href.split("/").filter(Boolean);
  return routePatterns().some(
    (pattern) =>
      pattern.length === segments.length &&
      pattern.every((p, i) =>
        p === "[seoSlug]"
          ? (ALLOWED_SEO_ROUTES as readonly string[]).includes(segments[i]!)
          : p.startsWith("[")
            ? true
            : p === segments[i]
      )
  );
}

describe("navigation targets", () => {
  const hrefs = [
    ...PRIMARY_NAV.map((i) => i.href),
    ...DASHBOARD_NAV.map((i) => i.href),
    ...FOOTER_NAV.flatMap((g) => g.items.map((i) => i.href)),
    "/",
    "/login",
    "/signup",
    "/dashboard",
  ];

  it.each([...new Set(hrefs)])("%s is an existing route", (href) => {
    expect(routeExists(href)).toBe(true);
  });

  it("the resolver rejects routes that do not exist", () => {
    expect(routeExists("/about")).toBe(false);
    expect(routeExists("/not-an-seo-slug")).toBe(false);
    expect(routeExists("/code/klingon")).toBe(false);
  });

  it("dashboard navigation includes the previously orphaned pages", () => {
    const dash = DASHBOARD_NAV.map((i) => i.href);
    expect(dash).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/dashboard/history",
        "/dashboard/certificates",
        "/dashboard/settings",
      ])
    );
  });
});

describe("current page", () => {
  const by = (list: typeof PRIMARY_NAV, label: string) =>
    list.find((i) => i.label === label)!;

  it.each([
    ["/typing-test", "Practice", true],
    ["/typing-test-with-certificate", "Practice", false],
    ["/typing-test-with-certificate", "Certificate", true],
    ["/code/python", "Code", true],
    ["/leaderboard", "Leaderboard", true],
    ["/pricing", "Pricing", true],
  ] as const)("%s → %s current: %s", (path, label, expected) => {
    expect(isCurrent(by(PRIMARY_NAV, label), path)).toBe(expected);
  });

  it("dashboard Overview is exact; sections match their sub-paths", () => {
    expect(isCurrent(by(DASHBOARD_NAV, "Overview"), "/dashboard")).toBe(true);
    expect(isCurrent(by(DASHBOARD_NAV, "Overview"), "/dashboard/history")).toBe(false);
    expect(isCurrent(by(DASHBOARD_NAV, "History"), "/dashboard/history")).toBe(true);
  });

  it("DashboardNav marks exactly the current section with aria-current", () => {
    nav.pathname = "/dashboard/certificates";
    render(h(DashboardNav));
    const current = document.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe("Certificates");
    expect(screen.getByRole("navigation", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(DASHBOARD_NAV.length);
  });
});

// ---------------------------------------------------------------------------
// Mobile navigation
// ---------------------------------------------------------------------------

function renderMobileNav(signedIn = false) {
  const main = document.createElement("main");
  main.id = "main-content";
  const footer = document.createElement("footer");
  footer.setAttribute("data-site-footer", "");
  document.body.append(main, footer);
  const utils = render(h(MobileNav, { signedIn }));
  const toggle = screen.getByRole("button", { name: "Open menu" });
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  return { ...utils, toggle, panel, main, footer };
}

describe("MobileNav", () => {
  afterEach(() => {
    document
      .querySelectorAll("#main-content, [data-site-footer]")
      .forEach((e) => e.remove());
  });

  it("starts closed with a labelled toggle that controls an existing panel", () => {
    const { toggle, panel } = renderMobileNav();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel).toBeTruthy();
    expect(panel.hidden).toBe(true);
  });

  it("opening: expanded, relabelled, focus on the first item, page inert and not scrollable", () => {
    const { toggle, panel, main, footer } = renderMobileNav();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Close menu");
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).toBe(panel.querySelector("a"));
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(main.hasAttribute("inert")).toBe(true);
    expect(footer.hasAttribute("inert")).toBe(true);
  });

  it("Escape closes, returns focus to the toggle and restores the page", () => {
    const { toggle, panel, main, footer } = renderMobileNav();
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(document.documentElement.style.overflow).toBe("");
    expect(main.hasAttribute("inert")).toBe(false);
    expect(footer.hasAttribute("inert")).toBe(false);
  });

  it("the toggle closes it again", () => {
    const { toggle, panel } = renderMobileNav();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(panel.hidden).toBe(true);
  });

  it("following a link closes it", () => {
    const { toggle, panel } = renderMobileNav();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("link", { name: "Leaderboard" }));
    expect(panel.hidden).toBe(true);
  });

  it("a route change closes it", () => {
    const { toggle, panel, rerender } = renderMobileNav();
    fireEvent.click(toggle);
    nav.pathname = "/leaderboard";
    rerender(h(MobileNav, { signedIn: false }));
    expect(panel.hidden).toBe(true);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("marks the current page and shows guest actions", () => {
    nav.pathname = "/leaderboard";
    const { toggle } = renderMobileNav(false);
    fireEvent.click(toggle);
    expect(
      screen.getByRole("link", { name: "Leaderboard" }).getAttribute("aria-current")
    ).toBe("page");
    expect(screen.getByRole("link", { name: "Sign up" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
  });

  it("shows signed-in actions", () => {
    const { toggle } = renderMobileNav(true);
    fireEvent.click(toggle);
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Header, theme toggle, skip link, footer
// ---------------------------------------------------------------------------

describe("SiteHeader", () => {
  it("every button has an accessible name; primary nav marks the current page", async () => {
    nav.pathname = "/pricing";
    await act(async () => {
      render(h(SiteHeader, { signedIn: false }));
    });
    for (const button of screen.getAllByRole("button")) {
      const name = button.getAttribute("aria-label") ?? button.textContent?.trim();
      expect(name).toBeTruthy();
    }
    const primary = screen.getByRole("navigation", { name: "Primary" });
    const current = primary.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe("Pricing");
    expect(screen.getByRole("link", { name: "TypeFlow home" }).getAttribute("href")).toBe(
      "/"
    );
  });

  it("signed in: Dashboard and Log out; signed out: Log in and Sign up", async () => {
    await act(async () => {
      render(h(SiteHeader, { signedIn: true }));
    });
    expect(screen.getAllByRole("link", { name: "Dashboard" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Log out" }).length).toBeGreaterThan(0);
    cleanup();
    await act(async () => {
      render(h(SiteHeader, { signedIn: false }));
    });
    expect(screen.getAllByRole("link", { name: "Sign up" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: "Log out" })).toHaveLength(0);
  });
});

describe("ThemeToggle", () => {
  it.each([
    ["dark", "Theme: Dark. Switch to Light", "light"],
    ["light", "Theme: Light. Switch to System", "system"],
    ["system", "Theme: System. Switch to Dark", "dark"],
    [undefined, "Theme: System. Switch to Dark", "dark"],
  ] as const)("theme %s: labelled, cycles to the next", async (theme, label, next) => {
    nav.theme = theme as never;
    await act(async () => {
      render(h(ThemeToggle));
    });
    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    expect(nav.setTheme).toHaveBeenCalledWith(next);
  });
});

describe("SkipLink and main landmark", () => {
  it("targets #main-content and is visible on focus", () => {
    render(h(SkipLink));
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link.getAttribute("href")).toBe("#main-content");
    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
  });

  it("the root layout renders the skip link first and exactly one focusable <main id=main-content>", () => {
    const layout = readFileSync(join(APP, "layout.tsx"), "utf8");
    expect(layout.match(/<main\b/g)).toHaveLength(1);
    expect(layout).toMatch(/<main\s+id="main-content"\s+tabIndex=\{-1\}/);
    expect(layout.indexOf("<SkipLink />")).toBeLessThan(layout.indexOf("<SiteHeader"));
    expect(layout).toContain("<SiteFooter />");
  });

  it("no page renders a second <main>", () => {
    const pages = routePatterns().length;
    expect(pages).toBeGreaterThan(20);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && full !== join(APP, "layout.tsx")) {
          const code = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "");
          if (/<main\b/.test(code)) offenders.push(relative(process.cwd(), full));
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});

describe("SiteFooter", () => {
  it("is a labelled navigation region the mobile menu can make inert", () => {
    render(h(SiteFooter));
    expect(screen.getByRole("navigation", { name: "Footer" })).toBeTruthy();
    expect(document.querySelector("footer[data-site-footer]")).toBeTruthy();
  });
});

describe("server/client boundary", () => {
  // Server components may pass client shell components only serializable
  // props. Nav items hold icon components (functions), which Next.js refuses
  // to send to the client ("Functions cannot be passed directly to Client
  // Components"): SiteHeader once passed them to NavLink, which passed every
  // happy-dom test but failed every server render.
  const CLIENT = ["NavLink", "PrimaryNav", "DashboardNav", "MobileNav", "ThemeToggle"];
  const ALLOWED_PROPS = new Set(["signedIn", "className", "key"]);
  const serverFiles = [
    "src/components/shell/SiteHeader.tsx",
    "src/components/shell/SiteFooter.tsx",
    "src/components/shell/SkipLink.tsx",
    "src/app/layout.tsx",
    "src/app/dashboard/layout.tsx",
  ];

  it.each(serverFiles)(
    "%s passes client shell components only serializable props",
    (file) => {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/^["']use client["']/);
      for (const m of src.matchAll(
        new RegExp(`<(${CLIENT.join("|")})\\b([^>]*)\\/?>`, "g")
      )) {
        const props = [...m[2]!.matchAll(/([A-Za-z]+)=/g)].map((p) => p[1]!);
        for (const prop of props)
          expect(ALLOWED_PROPS.has(prop), `${m[1]} ${prop}`).toBe(true);
      }
    }
  );

  it("the client shell components that read nav config are client components", () => {
    for (const name of [
      "NavLink",
      "PrimaryNav",
      "DashboardNav",
      "MobileNav",
      "ThemeToggle",
    ]) {
      const src = readFileSync(
        join(process.cwd(), `src/components/shell/${name}.tsx`),
        "utf8"
      );
      expect(src.startsWith('"use client"')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Area theme from the URL (no post-mount accent flash)
// ---------------------------------------------------------------------------

describe("experienceThemeForPath", () => {
  it.each([
    ["/", "standard"],
    ["/typing-test", "standard"],
    ["/code/javascript", "code"],
    ["/typing-test-with-certificate", "certificate"],
    ["/dashboard/certificates", "certificate"],
    ["/dashboard/billing", "pro"],
    ["/pricing", "pro"],
    ["/leaderboard", "standard"],
  ] as const)("%s → %s", (path, theme) => {
    expect(experienceThemeForPath(path)).toBe(theme);
  });

  it("is derived during render, not in an effect (so the server HTML is already right)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/providers/ExperienceProvider.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/useEffect|useState/);
    expect(src).toContain("experienceThemeForPath(usePathname()");
  });
});
