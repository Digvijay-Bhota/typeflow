import { LeaderboardClient } from "./LeaderboardClient";
import { constructMetadata } from "@/lib/seo";

export const metadata = constructMetadata({
  title: "Leaderboard",
  description: "View top typing speeds on TypeFlow.",
  path: "/leaderboard",
});

export default function LeaderboardPage() {
  return (
    <div className="max-w-5xl mx-auto py-12 px-4 w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground dark:text-foreground">Leaderboard</h1>
        <p className="text-muted mt-2">Top verified typing results.</p>
      </div>
      <LeaderboardClient />
    </div>
  );
}
