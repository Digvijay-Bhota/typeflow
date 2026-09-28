"use client";

import { NavLink } from "./NavLink";
import { PRIMARY_NAV } from "./navigation";

/**
 * Desktop primary navigation. A client component that reads the nav config
 * itself: nav items carry icon components, which cannot be passed from a
 * server component (SiteHeader) to a client one.
 */
export function PrimaryNav() {
  return (
    <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
      {PRIMARY_NAV.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          className="text-secondary hover:text-foreground hover:bg-surface-muted rounded-control px-3 py-2 text-sm font-medium transition-colors"
          currentClassName="text-foreground bg-surface-muted"
        />
      ))}
    </nav>
  );
}
