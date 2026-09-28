"use client";

import React, { createContext, useContext } from "react";
import { usePathname } from "next/navigation";

type ExperienceTheme = "standard" | "code" | "certificate" | "pro";

interface ExperienceContextType {
  theme: ExperienceTheme;
}

const ExperienceContext = createContext<ExperienceContextType>({ theme: "standard" });

/** The product area (and so the accent theme) of a URL path. */
export function experienceThemeForPath(pathname: string): ExperienceTheme {
  if (pathname.startsWith("/code/")) return "code";
  if (pathname.includes("certificate")) return "certificate";
  if (pathname.includes("billing") || pathname.includes("pricing")) return "pro";
  return "standard";
}

/**
 * Applies the area theme class. Derived from the URL during render (not in an
 * effect), so the server HTML and the first paint already carry the right
 * accent: no flash from the default accent to the area's.
 */
export function ExperienceProvider({ children }: { children: React.ReactNode }) {
  const theme = experienceThemeForPath(usePathname() ?? "/");

  return (
    <ExperienceContext.Provider value={{ theme }}>
      <div
        className={`theme-${theme} flex min-h-screen flex-1 flex-col transition-colors duration-300`}
      >
        {children}
      </div>
    </ExperienceContext.Provider>
  );
}

export const useExperienceTheme = () => useContext(ExperienceContext);
