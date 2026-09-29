import React from "react";
import { cn } from "@/components/ui";
import { pluralize } from "@/features/dashboard/lib/display";

const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Cell shades, lightest to darkest: the accent at rising strength. */
const LEVELS = [
  // A foreground tint (as Skeleton uses) stays visible on the card in both themes.
  "bg-foreground/10",
  "bg-accent/30",
  "bg-accent/55",
  "bg-accent/80",
  "bg-accent",
] as const;

type Level = 0 | 1 | 2 | 3 | 4;

function levelFor(count: number): Level {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

export type ActivityDay = { date: string; count: number; level: Level };

export type ActivityCalendar = {
  /** Week columns, Sunday first; null pads days outside the year. */
  weeks: (ActivityDay | null)[][];
  /** Month label for the columns where a new month starts. */
  monthLabels: (string | null)[];
  totalTests: number;
  activeDays: number;
};

/**
 * The last 365 days as week columns. Days are UTC calendar days, matching the
 * keys getActivityHeatmap() returns.
 */
export function buildActivityCalendar(
  data: Record<string, number>,
  today: Date = new Date()
): ActivityCalendar {
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = end - 364 * DAY_MS;
  // Pad back to the Sunday before, so every row is one weekday.
  const gridStart = start - new Date(start).getUTCDay() * DAY_MS;

  const weeks: (ActivityDay | null)[][] = [];
  let totalTests = 0;
  let activeDays = 0;

  for (let weekStart = gridStart; weekStart <= end; weekStart += 7 * DAY_MS) {
    const week: (ActivityDay | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const time = weekStart + i * DAY_MS;
      if (time < start || time > end) {
        week.push(null);
        continue;
      }
      const date = new Date(time).toISOString().slice(0, 10);
      const count = data[date] ?? 0;
      totalTests += count;
      if (count > 0) activeDays++;
      week.push({ date, count, level: levelFor(count) });
    }
    weeks.push(week);
  }

  // Label a column when its first day starts a new month, but not so close to
  // the next label that the two would overlap.
  const monthOf = (week: (ActivityDay | null)[]) => {
    const day = week.find((d) => d !== null);
    return day ? Number(day.date.slice(5, 7)) - 1 : -1;
  };
  const monthLabels = weeks.map((week, i) => {
    const month = monthOf(week);
    const previous = i === 0 ? -1 : monthOf(weeks[i - 1] ?? []);
    if (month === previous) return null;
    if (i === 0 && weeks.slice(1, 3).some((w) => monthOf(w) !== month)) return null;
    return MONTHS[month] ?? null;
  });

  return { weeks, monthLabels, totalTests, activeDays };
}

/** Tests per day over the past year. The summary sentence carries the data for screen readers. */
export function ActivityHeatmap({
  data,
  today,
}: {
  data: Record<string, number>;
  today?: Date;
}) {
  const { weeks, monthLabels, totalTests, activeDays } = buildActivityCalendar(
    data,
    today
  );
  const summary =
    totalTests === 0
      ? "No tests in the last 12 months."
      : `${pluralize(totalTests, "test")} on ${pluralize(activeDays, "day")} in the last 12 months.`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-secondary text-sm">{summary}</p>

      {/* rtl scroll container: opens scrolled to the most recent weeks on narrow screens;
          w-fit keeps it left-aligned when it does not need to scroll. */}
      <div
        role="region"
        aria-label="Activity calendar"
        tabIndex={0}
        className="w-fit max-w-full overflow-x-auto pb-2 [direction:rtl]"
      >
        <div
          role="img"
          aria-label={summary}
          className="inline-flex flex-col gap-1 [direction:ltr]"
        >
          <div aria-hidden="true" className="text-muted flex h-4 gap-[3px] text-xs">
            {monthLabels.map((label, i) => (
              <span key={i} className="relative w-[11px] shrink-0">
                {label && (
                  <span className="absolute left-0 whitespace-nowrap">{label}</span>
                )}
              </span>
            ))}
          </div>
          <div aria-hidden="true" className="flex gap-[3px]">
            {weeks.map((week, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {week.map((day, d) =>
                  day ? (
                    <span
                      key={d}
                      title={`${day.date}: ${pluralize(day.count, "test")}`}
                      className={cn("size-[11px] rounded-[2px]", LEVELS[day.level])}
                    />
                  ) : (
                    <span key={d} className="size-[11px]" />
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="text-muted flex items-center justify-end gap-2 text-xs"
      >
        Fewer
        {LEVELS.map((cls) => (
          <span key={cls} className={cn("size-[11px] rounded-[2px]", cls)} />
        ))}
        More
      </div>
    </div>
  );
}
