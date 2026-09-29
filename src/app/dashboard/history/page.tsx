import React from "react";
import { ArrowLeft, ArrowRight, History, SearchX } from "lucide-react";
import { getHistory } from "@/server/services/dashboard.service";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink, PageHeader } from "@/components/ui";
import { FilterBar } from "@/features/dashboard/components/FilterBar";
import {
  HistoryList,
  type HistoryRow,
} from "@/features/dashboard/components/HistoryList";
import { modeLabel } from "@/features/dashboard/lib/display";
import {
  DATE_RANGES,
  DATE_RANGE_LABELS,
  HISTORY_MODES,
  describeRange,
  historyHref,
  parseHistoryParams,
} from "@/features/dashboard/lib/searchParams";

const PAGE_SIZE = 20;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mode, range, cursor } = parseHistoryParams(await searchParams);

  const { results, nextCursor } = await getHistory(
    cursor?.id,
    cursor?.createdAt,
    PAGE_SIZE,
    {
      ...(mode !== "ALL" ? { mode } : {}),
      dateRange: range,
    }
  );

  const rows: HistoryRow[] = results.map((r) => ({
    id: r.id,
    shareId: r.shareId,
    createdAt: r.createdAt.toISOString(),
    wpm: r.wpm,
    accuracy: r.accuracy,
    duration: r.duration ?? r.session.duration ?? null,
    mode: r.session.mode,
    language: r.session.language,
    codeLanguage: r.session.codeLanguage,
    integrityStatus: r.integrityStatus,
  }));

  const filtered = mode !== "ALL" || range !== "all";
  const header = (
    <PageHeader
      title="History"
      description="Every test you've completed, newest first. Open one to see its full result."
    />
  );

  // A first-time user: nothing to filter yet, so no filters either.
  if (rows.length === 0 && !filtered && !cursor) {
    return (
      <div className="animate-fade-in flex flex-col gap-8 pb-12">
        {header}
        <EmptyState
          title="No tests yet"
          description="Each test you finish is saved here with its speed, accuracy and a link to the full result. Take your first one to start your history."
          actionText="Take a typing test"
          actionHref="/typing-test"
          icon={<History />}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col gap-8 pb-12">
      {header}

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6">
        <FilterBar
          label="Mode"
          options={HISTORY_MODES.map((m) => ({
            label: m === "ALL" ? "All" : modeLabel(m),
            href: historyHref({ mode: m, range }),
            current: m === mode,
          }))}
        />
        <FilterBar
          label="Period"
          options={DATE_RANGES.map((r) => ({
            label: DATE_RANGE_LABELS[r],
            href: historyHref({ mode, range: r }),
            current: r === range,
          }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No tests match these filters"
          description={`You have no ${mode === "ALL" ? "" : `${modeLabel(mode).toLowerCase()} `}tests from ${describeRange(range)}${cursor ? " older than the ones you've seen" : ""}. Try a wider period or another mode.`}
          actionText="Show all tests"
          actionHref={historyHref({ mode: "ALL", range: "all" })}
          icon={<SearchX />}
        />
      ) : (
        <>
          <HistoryList rows={rows} />

          <nav
            aria-label="History pages"
            className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-6"
          >
            <p className="text-secondary text-sm">
              {cursor ? "Older tests" : "Latest tests"} · showing {rows.length}
            </p>
            <div className="flex flex-wrap gap-3">
              {cursor && (
                <ButtonLink href={historyHref({ mode, range })} variant="secondary">
                  <ArrowLeft aria-hidden="true" />
                  Back to latest
                </ButtonLink>
              )}
              {nextCursor ? (
                <ButtonLink
                  href={historyHref({ mode, range, cursor: nextCursor })}
                  variant="secondary"
                >
                  Older tests
                  <ArrowRight aria-hidden="true" />
                </ButtonLink>
              ) : (
                <p className="text-muted self-center text-sm">That’s everything.</p>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
