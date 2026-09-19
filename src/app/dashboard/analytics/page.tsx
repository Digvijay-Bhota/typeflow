import React from "react";
import {
  getAnalyticsData,
  getActivityHeatmap,
  AnalyticsModeGroup,
  AnalyticsDateRange,
} from "@/server/services/dashboard.service";
import { ActivityHeatmap } from "@/features/analytics/components/ActivityHeatmap";
import { AnalyticsCharts } from "@/features/analytics/components/AnalyticsCharts";
import { EmptyState } from "@/components/EmptyState";
import { BarChart3 } from "lucide-react";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; range?: string; tz?: string }>;
}) {
  const params = await searchParams;
  const modeGroup = (params.mode as AnalyticsModeGroup) || "ENGLISH";
  const dateRange = (params.range as AnalyticsDateRange) || "30";
  const timezone = params.tz || "UTC";

  const { data: results, insights } = await getAnalyticsData(modeGroup, dateRange, timezone);
  const heatmap = await getActivityHeatmap();

  if (results.length === 0 && modeGroup === "ENGLISH" && dateRange === "30") {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <h1 className="mb-2 text-4xl font-black">Detailed Analytics</h1>
        <EmptyState
          title="No Analytics Data Yet"
          description="Analytics require at least one completed typing test to generate insights. Practice now to unlock your personalized performance charts!"
          icon={<BarChart3 className="text-accent h-10 w-10" />}
          actionText="Start a Test"
          actionHref="/typing-test"
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-6xl flex-col gap-10 pb-12">
      <div>
        <h1 className="text-4xl font-black">Detailed Analytics</h1>
        <p className="text-muted mt-2">
          Deep dive into your typing progression over time.
        </p>
      </div>

      <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
        <h2 className="mb-6 text-2xl font-bold">Activity Heatmap</h2>
        <p className="text-muted mb-6 text-sm">
          A comprehensive view of your practice sessions over the last 365 days.
        </p>
        <ActivityHeatmap data={heatmap} />
      </div>

      <AnalyticsCharts data={results} insights={insights} />
    </div>
  );
}
