"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import { ButtonLink, cn } from "@/components/ui";
import { NavLink } from "./NavLink";
import { PRIMARY_NAV } from "./navigation";

/** Page regions made inert (unreachable, unclickable) while the menu is open. */
const BACKGROUND = ["#main-content", "[data-site-footer]"];

/**
 * Mobile navigation (below the lg breakpoint).
 *
 * A disclosure: the toggle's aria-expanded/aria-controls point at the panel,
 * which stays in the DOM (hidden) so the reference is always valid. While
 * open, the page behind is `inert` and does not scroll, so keyboard focus
 * cannot wander onto hidden content, without a focus-trap library; the header
 * (and this toggle) stays reachable. Escape closes and returns focus to the
 * toggle; following a link, a route change or growing to desktop width
 * closes it.
 */
export function MobileNav({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  // Route change: close (no focus move; the new page takes over).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const background = BACKGROUND.flatMap((s) => [...document.querySelectorAll(s)]);
    background.forEach((el) => el.setAttribute("inert", ""));

    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => desktop.matches && close(false);
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);

    return () => {
      root.style.overflow = previousOverflow;
      background.forEach((el) => el.removeAttribute("inert"));
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [open, close]);

  const item =
    "flex h-11 items-center gap-3 rounded-control px-3 text-base font-medium text-secondary " +
    "hover:bg-surface-muted hover:text-foreground [&_svg]:size-5";

  return (
    <div className="lg:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="text-foreground hover:bg-surface-muted rounded-control inline-flex size-10 items-center justify-center transition-colors"
      >
        {open ? (
          <X aria-hidden="true" className="size-5" />
        ) : (
          <Menu aria-hidden="true" className="size-5" />
        )}
      </button>

      <div
        id={panelId}
        ref={panelRef}
        hidden={!open}
        className="bg-background border-border fixed inset-x-0 top-16 bottom-0 z-(--z-overlay) overflow-y-auto border-t"
      >
        <nav
          aria-label="Main menu"
          className="max-w-wide mx-auto flex flex-col gap-1 px-4 py-4"
        >
          {PRIMARY_NAV.map((nav) => {
            const Icon = nav.icon;
            return (
              <NavLink
                key={nav.href}
                item={nav}
                className={item}
                currentClassName="bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent"
                onNavigate={() => close(false)}
              >
                <Icon aria-hidden="true" />
                {nav.label}
              </NavLink>
            );
          })}

          <div className="bg-border my-3 h-px" role="separator" />

          {signedIn ? (
            <>
              <NavLink
                item={{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }}
                className={item}
                currentClassName="bg-accent-soft text-accent"
                onNavigate={() => close(false)}
              >
                <LayoutDashboard aria-hidden="true" />
                Dashboard
              </NavLink>
              <form action={logout}>
                <button type="submit" className={cn(item, "w-full text-left")}>
                  <LogOut aria-hidden="true" />
                  Log out
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col gap-2 pt-1">
              <ButtonLink
                href="/signup"
                size="lg"
                className="w-full"
                onClick={() => close(false)}
              >
                Sign up
              </ButtonLink>
              <ButtonLink
                href="/login"
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => close(false)}
              >
                Log in
              </ButtonLink>
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}
