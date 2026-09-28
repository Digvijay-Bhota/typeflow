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
  ArrowRight,
  Award,
  Check,
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

const CERTIFICATE_REQUIREMENTS = [
  `A ${CERTIFICATE_MINUTES}-minute verified test`,
  `At least ${CERTIFICATE_MIN_WPM} net WPM`,
  `At least ${CERTIFICATE_MIN_ACCURACY}% accuracy`,
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
      <section aria-labelledby="hero-heading" className="border-border border-b">
        <Container className="flex flex-col items-center gap-8 pt-10 pb-14 sm:gap-10 sm:pt-16 sm:pb-20">
          <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
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
          </div>

          <Card className="w-full max-w-4xl p-4 sm:p-8">
            <TypingTest />
          </Card>

          <div className="text-secondary flex flex-col items-center gap-x-6 gap-y-2 text-sm sm:flex-row">
            <InlineLink href="/code/javascript">Try a code typing test</InlineLink>
            <InlineLink href="/typing-test-with-certificate">
              Take the certified test
            </InlineLink>
          </div>
        </Container>
      </section>

      {/* 2. Why TypeFlow — the product loop */}
      <Section labelledBy="loop-heading">
        <SectionIntro
          id="loop-heading"
          eyebrow="Why TypeFlow"
          title="Measure, improve, track, prove."
        >
          One place for the whole loop, from your first test to a result you can share.
        </SectionIntro>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map(({ step, title, body, icon: StepIcon }) => (
            <li key={step}>
              <Card className="flex h-full flex-col gap-3 p-6">
                <div className="flex items-center justify-between">
                  <IconTile icon={StepIcon} />
                  <span
                    aria-hidden="true"
                    className="text-foreground-muted font-mono text-xs"
                  >
                    {step}
                  </span>
                </div>
                <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
                <p className="text-secondary text-sm leading-relaxed">{body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      {/* 3. Performance — metric definitions */}
      <Section labelledBy="metrics-heading" className="bg-surface-muted/50">
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
          <dl className="grid gap-4 sm:grid-cols-2">
            {METRICS.map(({ term, definition }) => (
              <Card key={term} className="flex flex-col gap-2 p-6">
                <dt className="font-mono text-sm font-semibold">{term}</dt>
                <dd className="text-secondary text-sm leading-relaxed">{definition}</dd>
              </Card>
            ))}
          </dl>
        </div>
      </Section>

      {/* 4. Certificate — in the certificate area accent */}
      <Section labelledBy="certificate-heading" className="theme-certificate">
        <Card className="grid gap-10 p-6 sm:p-10 lg:grid-cols-2 lg:gap-16">
          <div className="flex flex-col gap-6">
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
              <ul className="mt-3 flex flex-col gap-2">
                {CERTIFICATE_REQUIREMENTS.map((requirement) => (
                  <li key={requirement} className="flex items-start gap-2 text-sm">
                    <Check
                      aria-hidden="true"
                      className="text-accent mt-0.5 size-4 shrink-0"
                    />
                    {requirement}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ButtonLink href="/typing-test-with-certificate" size="lg">
                Take the certified test
                <ArrowRight aria-hidden="true" />
              </ButtonLink>
              <p className="text-secondary text-sm">
                {CERTIFICATE_PRICE}, one time, paid only after you qualify.
              </p>
            </div>
          </div>
          <div className="border-border flex flex-col gap-4 border-t pt-10 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-16">
            <h3 className="text-sm font-semibold">Every certificate includes</h3>
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

      {/* 5. Practice — ways to train */}
      <Section labelledBy="practice-heading">
        <SectionIntro
          id="practice-heading"
          eyebrow="Practice"
          title="Practice the way you actually type."
        >
          Prose, code or Hindi, at the length you choose.
        </SectionIntro>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRACTICE.map(({ title, body, href, icon }) => (
            <li key={href}>
              <Card className="group hover:border-border-strong has-[a:focus-visible]:outline-ring relative flex h-full flex-col gap-3 p-6 transition-colors has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2">
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
                  className="text-foreground-muted group-hover:text-accent mt-auto size-4 transition-colors"
                />
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      {/* 6. Final CTA */}
      <Section labelledBy="cta-heading" className="border-border border-t">
        <div className="flex flex-col items-center gap-6 text-center">
          <h2
            id="cta-heading"
            className="sm:text-title text-2xl font-semibold tracking-tight text-balance"
          >
            Your next test takes a minute.
          </h2>
          <p className="text-secondary max-w-md text-pretty">
            {user
              ? "Pick up where you left off, or start a fresh test."
              : "Start without an account. Sign up when you want to keep your results."}
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <ButtonLink href="/typing-test" size="lg">
              Start a typing test
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
      </Section>
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
    <div className="flex max-w-2xl flex-col gap-3">
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
