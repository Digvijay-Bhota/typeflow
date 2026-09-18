import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

import { constructMetadata } from "@/lib/seo";

export const metadata: Metadata = constructMetadata({
  title: "Practice smarter. Type faster. Prove your skills.",
  description:
    "TypeFlow is the ultimate typing performance platform. Practice typing, improve your WPM, and earn certificates.",
  path: "/",
});

metadata.icons = { icon: "/favicon.ico" };

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
};

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ExperienceProvider } from "@/components/providers/ExperienceProvider";
import { Navbar } from "@/components/Navbar";
import { getAuthenticatedUser } from "@/server/services/auth.service";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground selection:bg-accent/30 selection:text-accent-foreground min-h-screen antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ExperienceProvider>
            <Navbar user={user} />
            <main className="flex flex-1 flex-col">{children}</main>
          </ExperienceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
