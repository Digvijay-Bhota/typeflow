import React from "react";
import { getHistory } from "@/server/services/dashboard.service";
import Link from "next/link";
import { formatWpm, formatAccuracy, formatDuration } from "@/features/analytics/lib/formatMetrics";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ cursorId?: string; cursorCreatedAt?: string }> }) {
  const params = await searchParams;
  const { results, nextCursor } = await getHistory(params.cursorId, params.cursorCreatedAt, 20);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <h1 className="text-3xl font-bold text-foreground dark:text-foreground">Test History</h1>

      <div className="bg-surface dark:bg-surface border border-border dark:border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-background dark:bg-background text-muted uppercase">
              <tr>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Mode</th>
                <th className="px-6 py-4 font-semibold">WPM</th>
                <th className="px-6 py-4 font-semibold">Net</th>
                <th className="px-6 py-4 font-semibold">Accuracy</th>
                <th className="px-6 py-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-tf-text-100 dark:divide-tf-text-800">
              {results.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted">No test history found.</td>
                </tr>
              ) : results.map((r: { id: string; createdAt: Date; session: { mode: string; duration: number | null } | null; wpm: number; netWpm: number; accuracy: number; shareId: string }) => (
                <tr key={r.id} className="hover:bg-background dark:hover:bg-background transition-colors">
                  <td className="px-6 py-4">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    {r.session?.mode} 
                    {r.session?.duration ? ` ${formatDuration(r.session.duration * 1000)}` : ""}
                  </td>
                  <td className="px-6 py-4 font-bold text-accent">{formatWpm(r.wpm)}</td>
                  <td className="px-6 py-4">{formatWpm(r.netWpm)}</td>
                  <td className="px-6 py-4">{formatAccuracy(r.accuracy)}</td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/result/${r.shareId}`} className="text-accent font-medium hover:underline">View Result</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-border dark:border-border flex items-center justify-end">
          {nextCursor && (
            <Link 
              href={`/dashboard/history?cursorId=${nextCursor.id}&cursorCreatedAt=${nextCursor.createdAt}`}
              className="px-4 py-2 border border-border dark:border-border rounded-lg text-sm font-medium hover:bg-background dark:hover:bg-background"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
