"use client";

import { NavLink } from "./NavLink";
import { DASHBOARD_NAV } from "./navigation";

/**
 * Section tabs for /dashboard/*. Horizontal at every width (scrolls sideways
 * on small screens), so existing dashboard pages keep their full width.
 */
export function DashboardNav() {
  return (
    <nav aria-label="Dashboard" className="border-border -mx-4 border-b sm:mx-0">
      <ul className="flex gap-1 overflow-x-auto px-4 sm:px-0">
        {DASHBOARD_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href} className="shrink-0">
              <NavLink
                item={item}
                className="text-secondary hover:text-foreground -mb-px flex h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium transition-colors [&_svg]:size-4"
                currentClassName="text-foreground border-accent"
              >
                <Icon aria-hidden="true" />
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
