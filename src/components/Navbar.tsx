"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Keyboard,
  Code2,
  Award,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { logout } from "@/app/(auth)/actions";

export function Navbar({ user }: { user: any }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [_mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const navLinks = [
    { href: "/typing-test", label: "Practice", icon: Keyboard },
    { href: "/code/javascript", label: "Code", icon: Code2 },
    { href: "/typing-test-with-certificate", label: "Certificate", icon: Award },
    { href: "/leaderboard", label: "Leaderboard", icon: Award },
  ];

  const _authLinks = user
    ? [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/dashboard/settings", label: "Settings", icon: LayoutDashboard },
      ]
    : [];

  return (
    <header className="border-border bg-background/80 sticky top-0 z-50 w-full border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="group flex items-center gap-2">
            <div className="bg-accent text-accent-foreground rounded-lg p-1.5 transition-transform group-hover:scale-105">
              <Keyboard className="h-5 w-5" />
            </div>
            <span className="text-foreground font-mono text-xl font-bold tracking-tight">
              TypeFlow
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(link.href + "/");
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                    active ? "text-accent" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side actions */}
        <div className="hidden items-center gap-4 md:flex">
          {_mounted && (
            <button
              onClick={() =>
                setTheme(
                  theme === "dark" ? "light" : theme === "light" ? "system" : "dark"
                )
              }
              className="hover:bg-surface-elevated text-muted hover:text-foreground rounded-full p-2 transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? (
                <Moon className="h-4 w-4" />
              ) : theme === "light" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Monitor className="h-4 w-4" />
              )}
            </button>
          )}

          {user ? (
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-muted hover:text-foreground text-sm font-medium transition-colors"
              >
                Dashboard
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="text-danger hover:text-danger/80 flex items-center gap-2 text-sm font-medium transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link
                href="/login"
                className="text-muted hover:text-foreground text-sm font-medium transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="bg-foreground text-background rounded-full px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="text-muted hover:text-foreground -mr-2 p-2 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="border-border bg-background space-y-4 border-t px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-4">
            {navLinks.map((link) => {
              const active =
                pathname === link.href || pathname.startsWith(link.href + "/");
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 text-base font-medium ${
                    active ? "text-accent" : "text-muted"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {link.label}
                </Link>
              );
            })}

            <div className="bg-border my-2 h-px w-full" />

            {user ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="text-muted flex items-center gap-3 text-base font-medium"
                >
                  <LayoutDashboard className="h-5 w-5" />
                  Dashboard
                </Link>
                <form action={logout}>
                  <button
                    type="submit"
                    className="text-danger flex items-center gap-3 text-base font-medium"
                  >
                    <LogOut className="h-5 w-5" />
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="text-muted block text-base font-medium"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setMobileOpen(false)}
                  className="text-accent block text-base font-medium"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
