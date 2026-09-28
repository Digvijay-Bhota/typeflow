/**
 * TypeFlow Homepage
 *
 * Structure:
 * 1. Hero — the live typing test (immediately usable, no signup)
 * 2. Why TypeFlow — measure → improve → track → prove
 * 3. Performance — what each metric means and where it is calculated
 * 4. Certificate — requirements, what you get, price
 * 5. Practice — English, code, Hindi and targeted practice
 * 6. Final CTA
 *
 * Every claim on this page maps to a shipped feature; certificate rules and
 * price come from @/lib/constants so the copy cannot drift from the server.
 *
 * Performance: a server component; the typing test is the only client island
 * and the LCP element. No images, no animation libraries.
 */
import type { Metadata } from "next";
import type { ComponentType, ReactNode, SVGProps } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Award,
  BadgeCheck,
  ChartLine,
  Code2,
  Crosshair,
  FileText,
  Gauge,
  Hash,
  Keyboard,
  Languages,
  QrCode,
  ShieldCheck,
  Target,
} from "lucide-react";
import {
  APP_NAME,
  APP_TAGLINE,
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_MIN_WPM,
  CERTIFICATE_PRICE_INR,
} from "@/lib/constants";
import { TypingTest } from "@/features/typing/components/TypingTest";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { Badge, ButtonLink, Card, Container, cn } from "@/components/ui";

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description:
    "Free online typing test. Measure your WPM, track accuracy, practice adaptive typing, and earn verified certificates. No signup required to start.",
  alternates: {
    canonical: "/",
  },
};

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const CERTIFICATE_MINUTES = CERTIFICATE_MIN_DURATION / 60;
const CERTIFICATE_PRICE = `₹${(CERTIFICATE_PRICE_INR / 100).toLocaleString("en-IN")}`;

const LOOP: { step: string; title: string; body: string; icon: Icon }[] = [
  {
    step: "01",
    title: "Measure",
    body: "Every test reports WPM, accuracy and consistency, calculated on the server from your keystrokes.",
    icon: Gauge,
  },
  {
    step: "02",
    title: "Improve",
    body: "Each result breaks down the keys you miss most, so you know exactly what to practice next.",
    icon: Target,
  },
  {
    step: "03",
    title: "Track",
    body: "Sign in to keep every result in your history and follow your speed over time in analytics.",
    icon: ChartLine,
  },
  {
    step: "04",
    title: "Prove",
    body: `Pass a ${CERTIFICATE_MINUTES}-minute test and get a certificate anyone can check online.`,
    icon: Award,
  },
];

const METRICS: { term: string; definition: string }[] = [
  {
    term: "WPM",
    definition:
      "Correctly typed characters ÷ 5, per minute. Uncorrected errors lower your net WPM.",
  },
  {
    term: "Accuracy",
    definition: "Correct characters as a share of everything you typed.",
  },
  {
    term: "Consistency",
    definition:
      "How steady your speed stays, measured interval by interval across the test.",
  },
  {
    term: "Weak keys",
    definition: "The keys behind most of your errors, from a per-key breakdown.",
  },
];

/** The qualifying bar, as big figures; each reads as a phrase ("30 net WPM minimum"). */
const CERTIFICATE_REQUIREMENTS: { value: string; label: string }[] = [
  { value: `${CERTIFICATE_MINUTES} min`, label: "verified test" },
  { value: `${CERTIFICATE_MIN_WPM}`, label: "net WPM minimum" },
  { value: `${CERTIFICATE_MIN_ACCURACY}%`, label: "accuracy minimum" },
];

const HERO_METRICS: { label: string; icon: Icon }[] = [
  { label: "WPM", icon: Gauge },
  { label: "Accuracy", icon: Target },
  { label: "Consistency", icon: Activity },
];

const CERTIFICATE_CONTENTS: { label: string; icon: Icon }[] = [
  { label: "A unique certificate ID", icon: Hash },
  { label: "A QR code that opens its verification page", icon: QrCode },
  { label: "A public page showing your WPM, accuracy and issue date", icon: ShieldCheck },
  { label: "A downloadable PDF", icon: FileText },
];

const PRACTICE: { title: string; body: string; href: string; icon: Icon }[] = [
  {
    title: "English",
    body: "Timed tests from 15 seconds to 5 minutes, or a fixed number of words.",
    href: "/typing-test",
    icon: Keyboard,
  },
  {
    title: "Code",
    body: "JavaScript, TypeScript, Python, Java, C++ and SQL, with the brackets and operators left in.",
    href: "/code/javascript",
    icon: Code2,
  },
  {
    title: "Hindi",
    body: "The same tests and metrics, with Hindi passages.",
    href: "/hindi-typing-test",
    icon: Languages,
  },
  {
    title: "Targeted practice",
    body: "Sign in and get passages built around the keys you missed in your last ten tests.",
    href: "/practice",
    icon: Crosshair,
  },
];

export default async function HomePage() {
  const user = await getAuthenticatedUser();

  return (
    <div className="flex flex-col">
      {/* 1. Hero — the typing test is the page's primary action */}
      <section
        aria-labelledby="hero-heading"
        className="border-border relative isolate overflow-hidden border-b"
      >
        <HeroBackdrop />
        <Container className="flex flex-col items-center gap-8 pt-10 pb-12 sm:gap-10 sm:pt-16 sm:pb-16">
          <div className="flex max-w-2xl flex-col items-center gap-4 text-center sm:gap-5">
            <Badge tone="accent">Free · No account needed</Badge>
            <h1
              id="hero-heading"
              className="sm:text-display text-4xl font-semibold tracking-tight text-balance"
            >
              Type <span className="text-accent">faster.</span> Prove it.
            </h1>
            <p className="text-secondary max-w-xl text-base text-pretty sm:text-lg">
              Start typing below. Your browser records the keystrokes; the server
              calculates the score.
            </p>
            <ul
              aria-label="Measured on every test"
              className="text-secondary flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
            >
              {HERO_METRICS.map(({ label, icon: MetricIcon }) => (
                <li key={label} className="inline-flex items-center gap-1.5">
                  <MetricIcon aria-hidden="true" className="text-accent size-4" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <Card className="shadow-overlay relative w-full max-w-4xl p-4 sm:p-8">
            {/* A hairline of accent: marks the card as the page's live element. */}
            <span
              aria-hidden="true"
              className="via-accent/60 absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent to-transparent"
            />
            <TypingTest />
          </Card>

          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink
              href="/code/javascript"
              variant="ghost"
              size="sm"
              className="text-secondary hover:text-foreground"
            >
              <Code2 aria-hidden="true" />
              Code typing test
            </ButtonLink>
            <ButtonLink
              href="/typing-test-with-certificate"
              variant="ghost"
              size="sm"
              className="text-secondary hover:text-foreground"
            >
              <Award aria-hidden="true" />
              Certified test
            </ButtonLink>
          </div>
        </Container>
      </section>

      {/* 2. Why TypeFlow — the product loop, as one connected strip */}
      <Section labelledBy="loop-heading">
        <SectionIntro
          id="loop-heading"
          eyebrow="Why TypeFlow"
          title="Measure, improve, track, prove."
        >
          One place for the whole loop, from your first test to a result you can share.
        </SectionIntro>
        <ol className="reveal rounded-card border-border bg-border shadow-card mt-10 grid gap-px overflow-hidden border sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map(({ step, title, body, icon: StepIcon }) => (
            <li key={step} className="bg-surface flex flex-col gap-3 p-6">
              <div className="flex items-center justify-between">
                <IconTile icon={StepIcon} />
                <span aria-hidden="true" className="text-accent font-mono text-xs">
                  {step}
                </span>
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
              <p className="text-secondary text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* 3. Performance — metric definitions, on a muted band */}
      <Section
        labelledBy="metrics-heading"
        className="bg-surface-muted/60 border-border border-y"
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <div className="flex flex-col gap-6">
            <SectionIntro
              id="metrics-heading"
              eyebrow="Performance"
              title="Numbers with a definition behind them."
            >
              Scores are calculated on the server from your keystrokes, never taken from
              what the browser reports. Each result adds a speed-over-time chart and a
              per-key breakdown.
            </SectionIntro>
            <div>
              <InlineLink href="/how-wpm-is-calculated">How WPM is calculated</InlineLink>
            </div>
          </div>
          <dl className="reveal rounded-card border-border bg-border shadow-card grid gap-px self-start overflow-hidden border sm:grid-cols-2">
            {METRICS.map(({ term, definition }) => (
              <div key={term} className="bg-surface flex flex-col gap-2 p-6">
                <dt className="text-accent font-mono text-sm font-semibold">{term}</dt>
                <dd className="text-secondary text-sm leading-relaxed">{definition}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* 4. Certificate — proof of ability, in the certificate area accent */}
      <Section labelledBy="certificate-heading" className="theme-certificate">
        <Card className="reveal relative grid gap-10 overflow-hidden p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-14">
          <span
            aria-hidden="true"
            className="via-accent absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-transparent to-transparent"
          />
          <div className="flex flex-col gap-8">
            <SectionIntro
              id="certificate-heading"
              eyebrow="Certificate"
              title="A certificate anyone can verify."
            >
              Take the certified test. If your result qualifies, you can buy a certificate
              for it, and anyone you share it with can check it.
            </SectionIntro>
            <div>
              <h3 className="text-sm font-semibold">To qualify</h3>
              <ul className="mt-3 grid grid-cols-3 gap-3">
                {CERTIFICATE_REQUIREMENTS.map(({ value, label }) => (
                  <li
                    key={label}
                    className="border-border rounded-control flex flex-col gap-1 border p-3 sm:p-4"
                  >
                    <span className="text-accent font-mono text-xl font-semibold tabular-nums sm:text-2xl">
                      {value}
                    </span>
                    <span className="text-secondary text-xs leading-snug sm:text-sm">
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ButtonLink
                href="/typing-test-with-certificate"
                size="lg"
                className={PRESS_FEEDBACK}
              >
                Take the certified test
                <ArrowRight aria-hidden="true" />
              </ButtonLink>
              <p className="text-secondary text-sm">
                {CERTIFICATE_PRICE}, one time, paid only after you qualify.
              </p>
            </div>
          </div>

          {/* What the proof looks like: every element of a verifiable certificate. */}
          <div className="bg-accent-soft/40 border-border rounded-card flex flex-col gap-5 border p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="bg-accent text-accent-foreground inline-flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <BadgeCheck className="size-5" />
              </span>
              <h3 className="text-base font-semibold">Every certificate includes</h3>
            </div>
            <ul className="flex flex-col gap-4">
              {CERTIFICATE_CONTENTS.map(({ label, icon }) => (
                <li key={label} className="flex items-center gap-3 text-sm">
                  <IconTile icon={icon} />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </Section>

      {/* 5. Practice — ways to train, on the muted band */}
      <Section
        labelledBy="practice-heading"
        className="bg-surface-muted/60 border-border border-y"
      >
        <SectionIntro
          id="practice-heading"
          eyebrow="Practice"
          title="Practice the way you actually type."
        >
          Prose, code or Hindi, at the length you choose.
        </SectionIntro>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRACTICE.map(({ title, body, href, icon }) => (
            <li key={href} className="reveal">
              <Card className="group hover:border-accent/40 has-[a:focus-visible]:outline-ring ease-standard hover:shadow-overlay relative flex h-full flex-col gap-3 p-6 transition-[border-color,box-shadow,translate] duration-(--duration-base) has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 motion-safe:hover:-translate-y-0.5">
                <IconTile icon={icon} />
                <h3 className="text-lg font-semibold tracking-tight">
                  {/* The link's ::after covers the card, so the whole card is clickable
                      while the link's name stays the title; the card shows its focus. */}
                  <Link
                    href={href}
                    className="rounded-sm after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none"
                  >
                    {title}
                  </Link>
                </h3>
                <p className="text-secondary text-sm leading-relaxed">{body}</p>
                <ArrowRight
                  aria-hidden="true"
                  className="text-foreground-muted group-hover:text-accent mt-auto size-4 transition-[color,translate] duration-(--duration-base) motion-safe:group-hover:translate-x-1"
                />
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* 6. Final CTA — bookends the hero */}
      <section
        aria-labelledby="cta-heading"
        className="relative isolate overflow-hidden py-20 sm:py-28"
      >
        <span
          aria-hidden="true"
          className="from-accent-soft/70 absolute inset-0 -z-10 bg-linear-to-t to-transparent"
        />
        <Container>
          <div className="reveal flex flex-col items-center gap-6 text-center">
            <p className="text-accent font-mono text-xs font-medium tracking-wider uppercase">
              Ready when you are
            </p>
            <h2
              id="cta-heading"
              className="sm:text-display text-3xl font-semibold tracking-tight text-balance"
            >
              Start your next typing test.
            </h2>
            <p className="text-secondary max-w-md text-pretty sm:text-lg">
              {user
                ? "Pick up where you left off, or start a fresh test."
                : "It takes a minute and no account. Sign up when you want to keep your results."}
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <ButtonLink href="/typing-test" size="lg" className={PRESS_FEEDBACK}>
                Start a typing test
                <ArrowRight aria-hidden="true" />
              </ButtonLink>
              {user ? (
                <ButtonLink href="/dashboard" variant="secondary" size="lg">
                  Open dashboard
                </ButtonLink>
              ) : (
                <ButtonLink href="/signup" variant="secondary" size="lg">
                  Create a free account
                </ButtonLink>
              )}
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}

/** A small press response on primary CTAs; motion-safe only. */
const PRESS_FEEDBACK =
  "transition-[background-color,scale] motion-safe:active:scale-[0.98]";

/** Faint grid fading out from the top, over the accent's soft tint. Decorative. */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10">
      <div className="from-accent-soft/40 absolute inset-0 bg-linear-to-b to-transparent" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)] [background-size:40px_40px] opacity-70" />
    </div>
  );
}

function Section({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn("py-16 sm:py-20", className)}>
      <Container>{children}</Container>
    </section>
  );
}

function SectionIntro({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="reveal flex max-w-2xl flex-col gap-3">
      <p className="text-accent font-mono text-xs font-medium tracking-wider uppercase">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="sm:text-title text-2xl font-semibold tracking-tight text-balance"
      >
        {title}
      </h2>
      <p className="text-secondary text-pretty">{children}</p>
    </div>
  );
}

function IconTile({ icon: TileIcon }: { icon: Icon }) {
  return (
    <span
      aria-hidden="true"
      className="bg-accent-soft text-accent rounded-control inline-flex size-9 shrink-0 items-center justify-center"
    >
      <TileIcon className="size-4" />
    </span>
  );
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-foreground hover:text-accent inline-flex items-center gap-1 rounded-sm font-medium underline-offset-4 transition-colors hover:underline"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
