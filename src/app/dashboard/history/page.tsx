import React from "react";
import { getHistory } from "@/server/services/dashboard.service";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { History, ArrowRight, Activity, Target } from "lucide-react";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ cursorId?: string; cursorCreatedAt?: string }>;
}) {
  const params = await searchParams;
  const { results, nextCursor } = await getHistory(
    params.cursorId,
    params.cursorCreatedAt,
    20
  );

  if (results.length === 0 && !params.cursorId) {
    return (
      <div className="animate-fade-in flex flex-col gap-6 w-full max-w-5xl mx-auto">
        <h1 className="text-3xl font-black">Test History</h1>
        <EmptyState 
          title="No history yet" 
          description="Your completed typing tests will appear here. Take a test to start tracking your progress over time."
          actionText="Take a test"
          actionHref="/"
          icon={<History className="h-8 w-8 text-accent" />}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col gap-8 w-full max-w-5xl mx-auto pb-12">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-black">Test History</h1>
      </div>

      <div className="bg-surface border-border overflow-hidden rounded-3xl border shadow-sm hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-elevated/50 text-muted uppercase text-xs font-semibold tracking-wider">
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
                  className="hover:bg-background/80 transition-colors group"
                >
                  <td className="px-6 py-4 font-medium text-muted">
                    {new Date(r.createdAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-surface-elevated text-foreground border-border rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                      {r.session?.mode.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium capitalize text-muted">
                    {r.session?.codeLanguage ? (
                      <span className="text-blue-400 font-mono text-xs">{r.session.codeLanguage}</span>
                    ) : r.session?.language.toLowerCase()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-lg font-black text-foreground">{Math.round(r.wpm)}</span>
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-foreground">
                    {Math.round(r.accuracy * 100)}%
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/result/${r.shareId}`}
                      className="text-accent font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:underline flex items-center justify-end gap-1"
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
      <div className="md:hidden flex flex-col gap-4">
         {results.map((r: any) => (
           <Link key={r.id} href={`/result/${r.shareId}`} className="bg-surface border-border rounded-2xl border p-5 shadow-sm block hover:border-accent transition-colors">
              <div className="flex justify-between items-center mb-4">
                <span className="text-muted text-sm font-medium">
                  {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="bg-surface-elevated text-foreground border-border rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                  {r.session?.mode}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                   <div className="text-muted text-xs font-semibold uppercase tracking-wider mb-1 flex items-center gap-1"><Activity className="w-3 h-3"/> WPM</div>
                   <div className="text-3xl font-black">{Math.round(r.wpm)}</div>
                </div>
                <div>
                   <div className="text-muted text-xs font-semibold uppercase tracking-wider mb-1 flex items-center gap-1"><Target className="w-3 h-3"/> ACC</div>
                   <div className="text-3xl font-black">{Math.round(r.accuracy * 100)}%</div>
                </div>
              </div>
              
              <div className="flex items-center text-accent font-bold text-sm">
                 Full Result <ArrowRight className="h-4 w-4 ml-1" />
              </div>
           </Link>
         ))}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-6">
        <div className="text-muted text-sm font-medium">
          Showing {results.length} results
        </div>
        {nextCursor ? (
          <Link
            href={`/dashboard/history?cursorId=${nextCursor.id}&cursorCreatedAt=${nextCursor.createdAt}`}
            className="bg-surface-elevated text-foreground hover:bg-background border-border rounded-xl border px-6 py-3 text-sm font-bold shadow-sm transition-all flex items-center gap-2"
          >
            Older Tests <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <div className="text-muted text-sm font-medium italic">End of history</div>
        )}
      </div>
    </div>
  );
}
