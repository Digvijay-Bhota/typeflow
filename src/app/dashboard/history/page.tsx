import React from "react";
import { getHistory } from "@/server/services/dashboard.service";
import Link from "next/link";
import {
  formatWpm,
  formatAccuracy,
  formatDuration,
} from "@/features/analytics/lib/formatMetrics";

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

  return (
    <div className="animate-fade-in flex flex-col gap-6">
      <h1 className="text-foreground dark:text-foreground text-3xl font-bold">
        Test History
      </h1>

      <div className="bg-surface dark:bg-surface border-border dark:border-border overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-background dark:bg-background text-muted uppercase">
              <tr>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Mode</th>
                <th className="px-6 py-4 font-semibold">WPM</th>
                <th className="px-6 py-4 font-semibold">Net</th>
                <th className="px-6 py-4 font-semibold">Accuracy</th>
                <th className="px-6 py-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-tf-text-100 dark:divide-tf-text-800 divide-y">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted px-6 py-8 text-center">
                    No test history found.
                  </td>
                </tr>
              ) : (
                results.map(
                  (r: {
                    id: string;
                    createdAt: Date;
                    session: { mode: string; duration: number | null } | null;
                    wpm: number;
                    netWpm: number;
                    accuracy: number;
                    shareId: string;
                  }) => (
                    <tr
                      key={r.id}
                      className="hover:bg-background dark:hover:bg-background transition-colors"
                    >
                      <td className="px-6 py-4">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        {r.session?.mode}
                        {r.session?.duration
                          ? ` ${formatDuration(r.session.duration * 1000)}`
                          : ""}
                      </td>
                      <td className="text-accent px-6 py-4 font-bold">
                        {formatWpm(r.wpm)}
                      </td>
                      <td className="px-6 py-4">{formatWpm(r.netWpm)}</td>
                      <td className="px-6 py-4">{formatAccuracy(r.accuracy)}</td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/result/${r.shareId}`}
                          className="text-accent font-medium hover:underline"
                        >
                          View Result
                        </Link>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>

        <div className="border-border dark:border-border flex items-center justify-end border-t p-4">
          {nextCursor && (
            <Link
              href={`/dashboard/history?cursorId=${nextCursor.id}&cursorCreatedAt=${nextCursor.createdAt}`}
              className="border-border dark:border-border hover:bg-background dark:hover:bg-background rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
