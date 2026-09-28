import Link from "next/link";
import { Keyboard } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import { Button, ButtonLink, Container } from "@/components/ui";
import { MobileNav } from "./MobileNav";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The site header. A server component: only the pieces that need the browser
 * (current-page links, theme toggle, mobile menu) are client components. They
 * receive only serializable props (whether someone is signed in, not the user
 * record, and never nav items, whose icons are components).
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    // Solid background, no backdrop-filter: a filter would become the containing
    // block of the mobile menu's fixed panel and clip it to the header.
    <header className="border-border bg-background sticky top-0 z-(--z-header) border-b">
      <Container size="wide" className="flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="rounded-control flex items-center gap-2"
            aria-label="TypeFlow home"
          >
            <span
              aria-hidden="true"
              className="bg-accent text-accent-foreground rounded-control flex size-8 items-center justify-center"
            >
              <Keyboard className="size-4.5" />
            </span>
            <span className="font-mono text-lg font-bold tracking-tight">TypeFlow</span>
          </Link>

          <PrimaryNav />
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="hidden items-center gap-2 lg:flex">
            {signedIn ? (
              <>
                <ButtonLink href="/dashboard" variant="ghost" size="sm">
                  Dashboard
                </ButtonLink>
                <form action={logout}>
                  <Button type="submit" variant="ghost" size="sm">
                    Log out
                  </Button>
                </form>
              </>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost" size="sm">
                  Log in
                </ButtonLink>
                <ButtonLink href="/signup" size="sm">
                  Sign up
                </ButtonLink>
              </>
            )}
          </div>
          <MobileNav signedIn={signedIn} />
        </div>
      </Container>
    </header>
  );
}
