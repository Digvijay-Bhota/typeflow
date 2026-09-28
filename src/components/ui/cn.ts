import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge the custom scales in globals.css, so e.g. `text-title`
// (a size) is not mistaken for a colour and dropped next to `text-foreground`,
// and `rounded-full` correctly overrides `rounded-control`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title"],
      radius: ["control", "card"],
      shadow: ["card", "overlay"],
      container: ["page", "narrow"],
    },
  },
});

/** Joins class names and resolves Tailwind conflicts (the last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
