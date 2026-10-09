import Link from "next/link";
import { Container } from "@/components/ui";
import { FOOTER_NAV } from "./navigation";

/** Site footer: existing destinations only. */
export function SiteFooter() {
  return (
    <footer data-site-footer className="border-border bg-surface mt-auto border-t">
      <Container
        size="wide"
        className="flex flex-col gap-10 py-12 md:flex-row md:justify-between"
      >
        <div className="flex max-w-xs flex-col gap-2">
          <span className="font-mono text-base font-bold tracking-tight">TypeFlow</span>
          <p className="text-secondary text-sm">
            Practice, measure and prove your typing speed with server-verified results.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {FOOTER_NAV.map((group) => (
            <div key={group.title} className="flex flex-col gap-3">
              <h2 className="text-foreground text-sm font-semibold">{group.title}</h2>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-secondary hover:text-foreground rounded-sm text-sm transition-colors"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </Container>
      <Container size="wide" className="border-border text-muted border-t py-6 text-sm">
        © {new Date().getFullYear()} TypeFlow
      </Container>
    </footer>
  );
}
