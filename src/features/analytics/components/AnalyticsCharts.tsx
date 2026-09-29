import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { TrendChart } from "@/features/dashboard/components/TrendChart";
import {
  analyticsPeriod,
  bucketTrends,
  type AnalyticsBucket,
} from "../lib/analyticsSummary";

/**
 * Speed and accuracy over the selected period. With a single period there is
 * no trend to draw, so it says so instead of plotting one point.
 */
export function AnalyticsCharts({
  buckets,
  range,
}: {
  buckets: AnalyticsBucket[];
  range: string;
}) {
  const period = analyticsPeriod(range);
  const unit = period === "week" ? "week" : "day";

  if (buckets.length < 2) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-1">
          <h2 className="font-semibold">Trends need a little more practice</h2>
          <p className="text-secondary text-sm">
            All of these tests fall in one {unit}. Speed and accuracy charts appear once
            you have practised on at least two different {unit}s in this period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const trends = bucketTrends(buckets, period);
  const perUnit = period === "week" ? "weekly" : "daily";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle as="h2">Speed</CardTitle>
          <CardDescription>Average WPM per {unit}</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart
            points={trends.wpm}
            seriesName="Average WPM"
            categoryName={period === "week" ? "Week" : "Date"}
            unit="wpm"
            summary={`Line chart of your ${perUnit} average typing speed across ${buckets.length} ${unit}s.`}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Accuracy</CardTitle>
          <CardDescription>Average accuracy per {unit}</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart
            points={trends.accuracy}
            seriesName="Average accuracy"
            categoryName={period === "week" ? "Week" : "Date"}
            unit="percent"
            tone="success"
            summary={`Line chart of your ${perUnit} average accuracy across ${buckets.length} ${unit}s.`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
