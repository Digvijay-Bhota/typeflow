import { LeaderboardClient } from "./LeaderboardClient";
import { constructMetadata } from "@/lib/seo";

export const metadata = constructMetadata({
  title: "Leaderboard",
  description: "View top typing speeds on TypeFlow.",
  path: "/leaderboard",
});

export default function LeaderboardPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-foreground dark:text-foreground text-3xl font-bold">
          Leaderboard
        </h1>
        <p className="text-muted mt-2">Top verified typing results.</p>
      </div>
      <LeaderboardClient />
    </div>
  );
}
