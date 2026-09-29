import React from "react";
import { Keyboard } from "lucide-react";
import { getDashboardStats } from "@/server/services/dashboard.service";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { ButtonLink, PageHeader } from "@/components/ui";
import { DashboardOverview } from "@/features/dashboard/components/DashboardOverview";
import { FirstRunOverview } from "@/features/dashboard/components/FirstRunOverview";
import { formatPracticeTime } from "@/features/dashboard/lib/display";
import { buildOverview } from "@/features/dashboard/lib/overview";

export default async function DashboardPage() {
  const [stats, user] = await Promise.all([getDashboardStats(), getAuthenticatedUser()]);
  const name = user?.displayName?.trim() || null;
  const overview = buildOverview(stats);
  const isFirstRun = overview.totalTests === 0;

  return (
    <div className="animate-fade-in flex flex-col gap-8 pb-12">
      <PageHeader
        title={
          isFirstRun
            ? `Welcome to TypeFlow${name ? `, ${name}` : ""}`
            : `Welcome back${name ? `, ${name}` : ""}`
        }
        description={
          isFirstRun
            ? "This is your workspace. Your results, history and analytics collect here as you practise."
            : `You've completed ${overview.totalTests} ${overview.totalTests === 1 ? "test" : "tests"} and typed for ${formatPracticeTime(overview.totalTimeMs)}.`
        }
        actions={
          isFirstRun ? undefined : (
            <ButtonLink href="/typing-test">
              <Keyboard aria-hidden="true" />
              Start a typing test
            </ButtonLink>
          )
        }
      />

      {isFirstRun ? <FirstRunOverview /> : <DashboardOverview overview={overview} />}
    </div>
  );
}
