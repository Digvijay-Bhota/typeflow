import {
  Award,
  BarChart3,
  Code2,
  CreditCard,
  History,
  Keyboard,
  LayoutDashboard,
  Settings,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { LEGAL_PAGES } from "@/features/legal/legalPages";

/** A navigation destination. Every href is an existing route. */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Only this exact path is "current" (e.g. /dashboard, not its children). */
  exact?: boolean;
  /** Other path prefixes that also make this item current (e.g. rewrites). */
  alsoMatches?: string[];
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/typing-test", label: "Practice", icon: Keyboard, exact: true },
  // /code/:language is rewritten to /:language-typing-test (next.config.ts).
  { href: "/code/javascript", label: "Code", icon: Code2, alsoMatches: ["/code/"] },
  {
    href: "/typing-test-with-certificate",
    label: "Certificate",
    icon: Award,
    exact: true,
  },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/pricing", label: "Pricing", icon: Sparkles },
];

export const DASHBOARD_NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/history", label: "History", icon: History },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/certificates", label: "Certificates", icon: Award },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export const FOOTER_NAV: { title: string; items: { href: string; label: string }[] }[] = [
  {
    title: "Practice",
    items: [
      { href: "/typing-test", label: "Typing test" },
      { href: "/code-typing-test", label: "Code typing test" },
      { href: "/typing-test-with-certificate", label: "Certified test" },
      { href: "/leaderboard", label: "Leaderboard" },
    ],
  },
  {
    title: "Learn",
    items: [
      { href: "/typing-speed-guide", label: "Typing speed guide" },
      { href: "/how-wpm-is-calculated", label: "How WPM is calculated" },
      { href: "/how-to-increase-typing-speed", label: "Increase your speed" },
    ],
  },
  {
    title: "TypeFlow",
    items: [
      { href: "/pricing", label: "Pricing" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
  {
    title: "Legal",
    items: LEGAL_PAGES.map(({ href, label }) => ({ href, label })),
  },
];

/** Whether `item` is the current page for `pathname`. */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  if (!item.exact && pathname.startsWith(item.href + "/")) return true;
  return (item.alsoMatches ?? []).some((prefix) => pathname.startsWith(prefix));
}
