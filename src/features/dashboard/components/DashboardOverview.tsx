import Link from "next/link";
import {
  ArrowRight,
  Award,
  Gauge,
  Keyboard,
  ListChecks,
  Target,
  Trophy,
} from "lucide-react";
import {
  Badge,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  StatCard,
  cn,
} from "@/components/ui";
import {
  formatAccuracy,
  formatDuration,
  formatWpm,
} from "@/features/analytics/lib/formatMetrics";
import {
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_MIN_WPM,
} from "@/lib/constants";
import {
  formatPracticeTime,
  formatWpmDelta,
  keyLabel,
  languageLabel,
  modeLabel,
  pluralize,
} from "../lib/display";
import type { Overview, ResultSnapshot } from "../lib/overview";
import { LocalDateTime } from "./LocalDateTime";
import { TrendChart } from "./TrendChart";

function SummaryStats({ overview }: { overview: Overview }) {
  return (
    <section aria-labelledby="overview-summary" className="flex flex-col gap-4">
      <h2 id="overview-summary" className="text-lg font-semibold tracking-tight">
        All-time summary
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Tests completed"
          value={overview.totalTests}
          hint={`${formatPracticeTime(overview.totalTimeMs)} of typing`}
          icon={<ListChecks />}
        />
        <StatCard
          label="Average speed"
          value={`${formatWpm(overview.avgWpm)} WPM`}
          hint="Across all tests"
          icon={<Gauge />}
        />
        <StatCard
          label="Best speed"
          value={`${formatWpm(overview.bestWpm)} WPM`}
          hint="Personal best"
          icon={<Trophy />}
        />
        <StatCard
          label="Average accuracy"
          value={formatAccuracy(overview.avgAccuracy)}
          hint="Across all tests"
          icon={<Target />}
        />
      </div>
    </section>
  );
}

function describeTest(result: ResultSnapshot): string {
  return `${modeLabel(result.mode)} · ${languageLabel(result.language, result.codeLanguage)}`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-secondary text-sm">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function LatestResultCard({
  latest,
  delta,
  avgWpm,
  bestWpm,
  className,
}: {
  latest: ResultSnapshot;
  delta: number | null;
  avgWpm: number;
  bestWpm: number;
  className?: string;
}) {
  const fromBest = latest.wpm - bestWpm;
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle as="h2">Latest test</CardTitle>
        <CardDescription>
          <LocalDateTime value={latest.createdAt} /> · {describeTest(latest)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline gap-2">
            <span className="text-display font-semibold tabular-nums">
              {formatWpm(latest.wpm)}
            </span>
            <span className="text-secondary text-lg">WPM</span>
          </p>
          {delta !== null && (
            <Badge tone={Math.round(delta) > 0 ? "success" : "neutral"} className="w-fit">
              {formatWpmDelta(delta)} vs previous test
            </Badge>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <Figure label="Accuracy" value={formatAccuracy(latest.accuracy)} />
          <Figure label="Time" value={formatDuration(latest.elapsedMs)} />
          <Figure label="vs your average" value={formatWpmDelta(latest.wpm - avgWpm)} />
          <Figure
            label="vs your best"
            value={Math.round(fromBest) >= 0 ? "Personal best" : formatWpmDelta(fromBest)}
          />
        </dl>
      </CardContent>
      <CardFooter className="mt-auto">
        <ButtonLink href={`/result/${latest.shareId}`} variant="secondary">
          View full result
          <ArrowRight aria-hidden="true" />
        </ButtonLink>
      </CardFooter>
    </Card>
  );
}

/** The certificate route, with the real eligibility bar from constants. */
export function CertificatePath() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 font-medium">
          <Award aria-hidden="true" className="text-accent size-4" />
          Earn a verified certificate
        </p>
        <p className="text-secondary text-sm">
          Pass a {CERTIFICATE_MIN_DURATION / 60}-minute certified test at{" "}
          {CERTIFICATE_MIN_WPM}+ net WPM and {CERTIFICATE_MIN_ACCURACY}%+ accuracy.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link
          href="/typing-test-with-certificate"
          className="text-accent inline-flex min-h-6 items-center rounded-sm font-medium hover:underline"
        >
          Take the certified test
        </Link>
        <Link
          href="/dashboard/certificates"
          className="text-accent inline-flex min-h-6 items-center rounded-sm font-medium hover:underline"
        >
          Your certificates
        </Link>
      </div>
    </div>
  );
}

function NextStepsCard({
  weakKeys,
  sampleSize,
  className,
}: {
  weakKeys: Overview["weakKeys"];
  sampleSize: number;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle as="h2">What to do next</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {weakKeys.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="font-medium">Practise your most-missed keys</p>
              <p className="text-secondary text-sm">
                From your last {pluralize(sampleSize, "test")}.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {weakKeys.map(({ key, count }) => {
                const label = keyLabel(key);
                return (
                  <li
                    key={key}
                    className="rounded-control border-border bg-surface-muted flex items-center gap-2 border py-1 pr-2.5 pl-1"
                  >
                    <kbd
                      aria-hidden="true"
                      className="bg-surface border-border flex size-7 items-center justify-center rounded-md border font-mono text-sm font-semibold"
                    >
                      {label.visual}
                    </kbd>
                    <span className="sr-only">{label.spoken}:</span>
                    <span className="text-secondary text-xs tabular-nums">
                      {pluralize(count, "miss", "misses")}
                    </span>
                  </li>
                );
              })}
            </ul>
            <ButtonLink href="/practice" className="w-fit">
              <Keyboard aria-hidden="true" />
              Start targeted practice
            </ButtonLink>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="font-medium">Take another test</p>
              <p className="text-secondary text-sm">
                No missed keys stand out in your recent tests. Another test keeps your
                trend moving.
              </p>
            </div>
            <ButtonLink href="/typing-test" className="w-fit">
              <Keyboard aria-hidden="true" />
              Start a typing test
            </ButtonLink>
          </div>
        )}
        <div className="border-border border-t pt-5">
          <CertificatePath />
        </div>
      </CardContent>
    </Card>
  );
}

function TrendCard({ overview, className }: { overview: Overview; className?: string }) {
  const { trend } = overview;
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle as="h2">Speed trend</CardTitle>
        <CardDescription>
          {trend.length >= 2
            ? `WPM of your last ${trend.length} tests, oldest to newest.`
            : "WPM of your recent tests."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {trend.length >= 2 ? (
          <TrendChart
            points={trend}
            seriesName="WPM"
            categoryName="Test"
            unit="wpm"
            summary={`Line chart of the typing speed of your last ${trend.length} tests, oldest to newest.`}
          />
        ) : (
          <p className="text-secondary text-sm">
            Your trend appears after your second test. One result is a starting point, two
            show a direction.
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Link
          href="/dashboard/analytics"
          className="text-accent inline-flex min-h-6 items-center gap-1 rounded-sm text-sm font-medium hover:underline"
        >
          Open analytics
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

function RecentTestsCard({
  recent,
  className,
}: {
  recent: ResultSnapshot[];
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle as="h2">Recent tests</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-3">
        <ul className="divide-border -mx-2 flex flex-col divide-y">
          {recent.map((result) => (
            <li key={result.id}>
              <Link
                href={`/result/${result.shareId}`}
                className="rounded-control hover:bg-surface-muted flex items-center justify-between gap-3 px-2 py-2.5 transition-colors"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium tabular-nums">
                    {formatWpm(result.wpm)} WPM · {formatAccuracy(result.accuracy)}
                  </span>
                  <span className="text-muted truncate text-xs">
                    <LocalDateTime value={result.createdAt} /> · {modeLabel(result.mode)}
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="text-muted size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Link
          href="/dashboard/history"
          className="text-accent inline-flex min-h-6 items-center gap-1 rounded-sm text-sm font-medium hover:underline"
        >
          See all history
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}

/** The workspace overview for someone with at least one completed test. */
export function DashboardOverview({ overview }: { overview: Overview }) {
  return (
    <div className="flex flex-col gap-8">
      <SummaryStats overview={overview} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {overview.latest && (
          <LatestResultCard
            latest={overview.latest}
            delta={overview.latestDelta}
            avgWpm={overview.avgWpm}
            bestWpm={overview.bestWpm}
            className="lg:col-span-2"
          />
        )}
        <NextStepsCard
          weakKeys={overview.weakKeys}
          sampleSize={overview.sampleSize}
          {...(overview.latest ? {} : { className: "lg:col-span-3" })}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TrendCard overview={overview} className="lg:col-span-2" />
        {overview.recent.length > 0 && <RecentTestsCard recent={overview.recent} />}
      </div>
    </div>
  );
}
