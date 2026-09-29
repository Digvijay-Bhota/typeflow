import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Card, VisuallyHidden } from "@/components/ui";
import { formatAccuracy, formatWpm } from "@/features/analytics/lib/formatMetrics";
import { formatTestLength, languageLabel, modeLabel } from "../lib/display";
import { LocalDateTime } from "./LocalDateTime";

/** One row of getHistory(), with its date as an ISO string. */
export type HistoryRow = {
  id: string;
  shareId: string;
  createdAt: string;
  wpm: number;
  accuracy: number;
  /** Test length in seconds, if it had one. */
  duration: number | null;
  mode: string;
  language: string;
  codeLanguage: string | null;
  integrityStatus: string;
};

function IntegrityBadge({ status }: { status: string }) {
  if (status === "REVIEW") return <Badge tone="warning">Under review</Badge>;
  if (status === "INVALID") return <Badge tone="danger">Invalid</Badge>;
  return null;
}

/** "Timed · 1 min · English" */
function testDescription(row: HistoryRow): string {
  return [
    modeLabel(row.mode),
    formatTestLength(row.duration),
    languageLabel(row.language, row.codeLanguage),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Completed tests, newest first: a table from md up, a list of cards below it.
 * Every row links to its full result page.
 */
export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  return (
    <>
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Completed typing tests, newest first</caption>
          <thead className="bg-surface-muted text-secondary">
            <tr>
              {/* Wide enough for the server's "…, 12:48 PM UTC", so the column does
                  not reflow when the browser switches it to local time. */}
              <th scope="col" className="w-60 px-5 py-3 font-medium">
                Date
              </th>
              <th scope="col" className="px-5 py-3 font-medium">
                Test
              </th>
              <th scope="col" className="px-5 py-3 text-right font-medium">
                WPM
              </th>
              <th scope="col" className="px-5 py-3 text-right font-medium">
                Accuracy
              </th>
              <th scope="col" className="px-5 py-3 text-right font-medium">
                <VisuallyHidden>Result</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-muted/60 transition-colors">
                <td className="text-secondary px-5 py-3 whitespace-nowrap">
                  <LocalDateTime value={row.createdAt} />
                </td>
                <td className="px-5 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    {testDescription(row)}
                    <IntegrityBadge status={row.integrityStatus} />
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-base font-semibold tabular-nums">
                  {formatWpm(row.wpm)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {formatAccuracy(row.accuracy)}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/result/${row.shareId}`}
                    className="text-accent inline-flex min-h-6 items-center gap-1 rounded-sm font-medium whitespace-nowrap hover:underline"
                  >
                    View
                    <VisuallyHidden>
                      {" "}
                      result from <LocalDateTime value={row.createdAt} />
                    </VisuallyHidden>
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/result/${row.shareId}`}
              className="rounded-card border-border bg-surface shadow-card hover:border-border-strong flex flex-col gap-3 border p-4 transition-colors"
            >
              <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-secondary">
                  <LocalDateTime value={row.createdAt} />
                </span>
                <IntegrityBadge status={row.integrityStatus} />
              </span>
              <span className="flex items-end justify-between gap-4">
                <span className="flex items-baseline gap-4">
                  <span>
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatWpm(row.wpm)}
                    </span>{" "}
                    <span className="text-secondary text-sm">WPM</span>
                  </span>
                  <span>
                    <span className="text-lg font-medium tabular-nums">
                      {formatAccuracy(row.accuracy)}
                    </span>{" "}
                    <span className="text-secondary text-sm">accuracy</span>
                  </span>
                </span>
                <ArrowRight aria-hidden="true" className="text-accent size-4 shrink-0" />
              </span>
              <span className="text-muted text-sm">{testDescription(row)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
