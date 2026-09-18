"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Keyboard, Code2, Award, LayoutDashboard, LogOut, Menu, X, Monitor, Moon, Sun } from "lucide-react";
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
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="bg-accent text-accent-foreground p-1.5 rounded-lg group-hover:scale-105 transition-transform">
              <Keyboard className="w-5 h-5" />
            </div>
            <span className="font-mono font-bold text-xl tracking-tight text-foreground">
              TypeFlow
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                    active ? "text-accent" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side actions */}
        <div className="hidden md:flex items-center gap-4">
          {_mounted && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
              className="p-2 rounded-full hover:bg-surface-elevated text-muted hover:text-foreground transition-colors"
              title="Toggle theme"
            >
              {theme === "dark" ? <Moon className="w-4 h-4" /> : theme === "light" ? <Sun className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            </button>
          )}

          {user ? (
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Dashboard
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="flex items-center gap-2 text-sm font-medium text-danger hover:text-danger/80 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link
                href="/login"
                className="text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="text-sm font-medium px-4 py-2 bg-foreground text-background rounded-full hover:opacity-90 transition-opacity"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden p-2 -mr-2 text-muted hover:text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-4">
          <nav className="flex flex-col gap-4">
            {navLinks.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
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
                  <Icon className="w-5 h-5" />
                  {link.label}
                </Link>
              );
            })}
            
            <div className="h-px bg-border w-full my-2" />
            
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 text-base font-medium text-muted"
                >
                  <LayoutDashboard className="w-5 h-5" />
                  Dashboard
                </Link>
                <form action={logout}>
                  <button
                    type="submit"
                    className="flex items-center gap-3 text-base font-medium text-danger"
                  >
                    <LogOut className="w-5 h-5" />
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                  className="block text-base font-medium text-muted"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  onClick={() => setMobileOpen(false)}
                  className="block text-base font-medium text-accent"
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
