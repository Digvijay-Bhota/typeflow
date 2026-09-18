"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";

type ExperienceTheme = "standard" | "code" | "certificate" | "pro";

interface ExperienceContextType {
  theme: ExperienceTheme;
}

const ExperienceContext = createContext<ExperienceContextType>({ theme: "standard" });

export function ExperienceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<ExperienceTheme>("standard");

  useEffect(() => {
    if (pathname.startsWith("/code/")) {
      setTheme("code");
    } else if (pathname.includes("certificate")) {
      setTheme("certificate");
    } else if (pathname.includes("billing") || pathname.includes("pricing")) {
      setTheme("pro");
    } else {
      setTheme("standard");
    }
  }, [pathname]);

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
