import React from "react";
import { getHistory } from "@/server/services/dashboard.service";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { History, ArrowRight, Activity, Target } from "lucide-react";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    cursorId?: string;
    cursorCreatedAt?: string;
    mode?: string;
    range?: string;
  }>;
}) {
  const params = await searchParams;
  const currentMode = params.mode || "ALL";
  const currentRange = params.range || "all";

  const { results, nextCursor } = await getHistory(
    params.cursorId,
    params.cursorCreatedAt,
    20,
    {
      ...(params.mode !== "ALL" ? { mode: params.mode } : {}),
      dateRange: currentRange,
    }
  );

  const getFilterUrl = (overrides: { mode?: string; range?: string }) => {
    const search = new URLSearchParams();
    search.set("mode", overrides.mode !== undefined ? overrides.mode : currentMode);
    search.set("range", overrides.range !== undefined ? overrides.range : currentRange);
    return `/dashboard/history?${search.toString()}`;
  };

  const getCursorUrl = () => {
    const search = new URLSearchParams();
    search.set("mode", currentMode);
    search.set("range", currentRange);
    if (nextCursor) {
      search.set("cursorId", nextCursor.id);
      search.set("cursorCreatedAt", nextCursor.createdAt);
    }
    return `/dashboard/history?${search.toString()}`;
  };

  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-5xl flex-col gap-8 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-black">Test History</h1>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="bg-surface border-border flex w-max items-center rounded-2xl border p-1 shadow-sm">
            {["ALL", "TIMED", "WORDS", "CODE", "PRACTICE"].map((mode) => (
              <Link
                key={mode}
                href={getFilterUrl({ mode })}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                  currentMode === mode
                    ? "bg-foreground text-background shadow-md"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {mode === "ALL" ? "All Modes" : mode}
              </Link>
            ))}
          </div>

          <div className="bg-surface border-border flex w-max items-center rounded-2xl border p-1 shadow-sm">
            {[
              { label: "7D", value: "7" },
              { label: "30D", value: "30" },
              { label: "90D", value: "90" },
              { label: "All", value: "all" },
            ].map((range) => (
              <Link
                key={range.value}
                href={getFilterUrl({ range: range.value })}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                  currentRange === range.value
                    ? "bg-accent text-white shadow-md"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {range.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {results.length === 0 && !params.cursorId ? (
        <EmptyState
          title="No history yet"
          description="Your completed typing tests matching these filters will appear here."
          actionText="Take a test"
          actionHref="/"
          icon={<History className="text-accent h-8 w-8" />}
        />
      ) : (
        <>
          <div className="bg-surface border-border hidden overflow-hidden rounded-3xl border shadow-sm md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-elevated/50 text-muted text-xs font-semibold tracking-wider uppercase">
                  <tr>
                    <th className="px-6 py-5">Date</th>
                    <th className="px-6 py-5">Mode</th>
                    <th className="px-6 py-5">Language</th>
                    <th className="px-6 py-5 text-right">WPM</th>
                    <th className="px-6 py-5 text-right">Accuracy</th>
                    <th className="px-6 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-border/50 divide-y">
                  {results.map((r: any) => (
                    <tr
                      key={r.id}
                      className="hover:bg-background/80 group transition-colors"
                    >
                      <td className="text-muted px-6 py-4 font-medium">
                        {new Date(r.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <span className="bg-surface-elevated text-foreground border-border rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide uppercase">
                          {r.session?.mode.toLowerCase()}
                        </span>
                      </td>
                      <td className="text-muted px-6 py-4 font-medium capitalize">
                        {r.session?.codeLanguage ? (
                          <span className="font-mono text-xs text-blue-400">
                            {r.session.codeLanguage}
                          </span>
                        ) : (
                          r.session?.language.toLowerCase()
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-foreground text-lg font-black">
                          {Math.round(r.wpm)}
                        </span>
                      </td>
                      <td className="text-foreground px-6 py-4 text-right font-bold">
                        {Math.round(r.accuracy * 100)}%
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/result/${r.shareId}`}
                          className="text-accent flex items-center justify-end gap-1 font-bold opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
                        >
                          View <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile view: Cards instead of table */}
          <div className="flex flex-col gap-4 md:hidden">
            {results.map((r: any) => (
              <Link
                key={r.id}
                href={`/result/${r.shareId}`}
                className="bg-surface border-border hover:border-accent block rounded-2xl border p-5 shadow-sm transition-colors"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-muted text-sm font-medium">
                    {new Date(r.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="bg-surface-elevated text-foreground border-border rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                    {r.session?.mode}
                  </span>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-muted mb-1 flex items-center gap-1 text-xs font-semibold tracking-wider uppercase">
                      <Activity className="h-3 w-3" /> WPM
                    </div>
                    <div className="text-3xl font-black">{Math.round(r.wpm)}</div>
                  </div>
                  <div>
                    <div className="text-muted mb-1 flex items-center gap-1 text-xs font-semibold tracking-wider uppercase">
                      <Target className="h-3 w-3" /> ACC
                    </div>
                    <div className="text-3xl font-black">
                      {Math.round(r.accuracy * 100)}%
                    </div>
                  </div>
                </div>

                <div className="text-accent flex items-center text-sm font-bold">
                  Full Result <ArrowRight className="ml-1 h-4 w-4" />
                </div>
              </Link>
            ))}
          </div>

          <div className="border-border flex items-center justify-between border-t pt-6">
            <div className="text-muted text-sm font-medium">
              Showing {results.length} results
            </div>
            {nextCursor ? (
              <Link
                href={getCursorUrl()}
                className="bg-surface-elevated text-foreground hover:bg-background border-border flex items-center gap-2 rounded-xl border px-6 py-3 text-sm font-bold shadow-sm transition-all"
              >
                Older Tests <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <div className="text-muted text-sm font-medium italic">End of history</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
