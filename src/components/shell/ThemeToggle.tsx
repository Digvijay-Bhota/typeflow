"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/components/ui";

const ORDER = ["dark", "light", "system"] as const;
type Choice = (typeof ORDER)[number];

const LABEL: Record<Choice, string> = { dark: "Dark", light: "Light", system: "System" };
const ICON = { dark: Moon, light: Sun, system: Monitor };

/**
 * Cycles dark → light → system. The chosen theme is unknown on the server, so
 * until mounted a same-size placeholder is rendered (no hydration mismatch,
 * no layout shift).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const box = cn(
    "inline-flex size-9 items-center justify-center rounded-control",
    className
  );
  if (!mounted) return <span aria-hidden="true" className={box} />;

  const current: Choice = ORDER.includes(theme as Choice) ? (theme as Choice) : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
  const Icon = ICON[current];
  const label = `Theme: ${LABEL[current]}. Switch to ${LABEL[next]}`;

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cn(
        box,
        "text-secondary hover:bg-surface-muted hover:text-foreground transition-colors"
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
