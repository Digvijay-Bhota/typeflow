"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { isCurrent, type NavItem } from "./navigation";

type NavLinkProps = {
  item: NavItem;
  className?: string;
  /** Classes added when this link is the current page. */
  currentClassName?: string;
  children?: ReactNode;
  onNavigate?: () => void;
};

/** A navigation link that marks itself aria-current="page" on its own route. */
export function NavLink({
  item,
  className,
  currentClassName,
  children,
  onNavigate,
}: NavLinkProps) {
  const current = isCurrent(item, usePathname() ?? "/");
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(className, current && currentClassName)}
      {...(onNavigate ? { onClick: onNavigate } : {})}
    >
      {children ?? item.label}
    </Link>
  );
}
