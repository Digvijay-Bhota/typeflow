import React, { Suspense } from "react";
import { BarChart3, Gauge, Lightbulb, ListChecks, Target, Trophy } from "lucide-react";
import {
  getActivityHeatmap,
  getAnalyticsData,
} from "@/server/services/dashboard.service";
import { EmptyState } from "@/components/EmptyState";
import {
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
} from "@/components/ui";
import { ActivityHeatmap } from "@/features/analytics/components/ActivityHeatmap";
import { AnalyticsCharts } from "@/features/analytics/components/AnalyticsCharts";
import { TimezoneSync } from "@/features/analytics/components/TimezoneSync";
import { summarizeBuckets } from "@/features/analytics/lib/analyticsSummary";
import { formatAccuracy, formatWpm } from "@/features/analytics/lib/formatMetrics";
import { FilterBar } from "@/features/dashboard/components/FilterBar";
import {
  ANALYTICS_MODES,
  DATE_RANGES,
  DATE_RANGE_LABELS,
  analyticsHref,
  describeRange,
  parseAnalyticsParams,
  type AnalyticsMode,
} from "@/features/dashboard/lib/searchParams";

const MODE_LABELS: Record<AnalyticsMode, string> = {
  ENGLISH: "Standard",
  CODE: "Code",
  PRACTICE: "Practice",
};

const MODE_DESCRIPTIONS: Record<AnalyticsMode, string> = {
  ENGLISH: "English timed, word and certified tests",
  CODE: "code typing tests",
  PRACTICE: "practice sessions",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseAnalyticsParams(await searchParams);
  const [{ data: buckets, insights }, heatmap] = await Promise.all([
    getAnalyticsData(params.mode, params.range, params.tz ?? "UTC"),
    getActivityHeatmap(),
  ]);

  const hasActivity = Object.keys(heatmap).length > 0;
  const summary = summarizeBuckets(buckets);

  const header = (
    <PageHeader
      title="Analytics"
      description="How your speed and accuracy change over time, built from the tests you complete."
    />
  );

  if (!hasActivity && buckets.length === 0) {
    return (
      <div className="animate-fade-in flex flex-col gap-8 pb-12">
        {header}
        <EmptyState
          title="No activity to analyse yet"
          description="Once you complete a test, this page charts your average speed and accuracy day by day, and fills in a calendar of the days you practised."
          actionText="Take a typing test"
          actionHref="/typing-test"
          icon={<BarChart3 />}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col gap-8 pb-12">
      <Suspense fallback={null}>
        <TimezoneSync />
      </Suspense>
      {header}

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6">
        <FilterBar
          label="Test type"
          options={ANALYTICS_MODES.map((mode) => ({
            label: MODE_LABELS[mode],
            href: analyticsHref({ ...params, mode }),
            current: mode === params.mode,
          }))}
        />
        <FilterBar
          label="Period"
          options={DATE_RANGES.map((range) => ({
            label: DATE_RANGE_LABELS[range],
            href: analyticsHref({ ...params, range }),
            current: range === params.range,
          }))}
        />
      </div>

      <section aria-labelledby="analytics-summary" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="analytics-summary" className="text-lg font-semibold tracking-tight">
            Summary
          </h2>
          <p className="text-secondary text-sm">
            {MODE_LABELS[params.mode]} ({MODE_DESCRIPTIONS[params.mode]}),{" "}
            {describeRange(params.range)}.
          </p>
        </div>

        {summary ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Tests" value={summary.tests} icon={<ListChecks />} />
            <StatCard
              label="Average speed"
              value={`${formatWpm(summary.avgWpm)} WPM`}
              icon={<Gauge />}
            />
            <StatCard
              label="Best speed"
              value={`${formatWpm(summary.bestWpm)} WPM`}
              icon={<Trophy />}
            />
            <StatCard
              label="Average accuracy"
              value={formatAccuracy(summary.avgAccuracy)}
              icon={<Target />}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-start gap-4">
              <div className="flex flex-col gap-1">
                <p className="font-semibold">
                  No {MODE_LABELS[params.mode].toLowerCase()} tests in{" "}
                  {describeRange(params.range)}
                </p>
                <p className="text-secondary text-sm">
                  Pick a longer period or another test type, or take a test to add to it.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {params.range !== "all" && (
                  <ButtonLink
                    href={analyticsHref({ ...params, range: "all" })}
                    variant="secondary"
                  >
                    Show all time
                  </ButtonLink>
                )}
                <ButtonLink
                  href={params.mode === "CODE" ? "/code/javascript" : "/typing-test"}
                >
                  Take a test
                </ButtonLink>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {summary && buckets.length > 2 && insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle as="h2" className="flex items-center gap-2">
              <Lightbulb aria-hidden="true" className="text-accent size-5" />
              Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {insights.map((insight) => (
                <li key={insight}>{insight}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {summary && <AnalyticsCharts buckets={buckets} range={params.range} />}

      <Card>
        <CardHeader>
          <CardTitle as="h2">Activity</CardTitle>
          <CardDescription>
            Tests per day over the past year, all test types.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap data={heatmap} />
        </CardContent>
      </Card>
    </div>
  );
}
