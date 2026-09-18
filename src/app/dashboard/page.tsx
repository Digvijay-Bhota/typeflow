import React from "react";
import { getDashboardStats } from "@/server/services/dashboard.service";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { DashboardClient } from "@/features/dashboard/components/DashboardClient";

export default async function DashboardPage() {
  const stats = await getDashboardStats();
  const user = await getAuthenticatedUser();

  return <DashboardClient stats={stats} user={user} />;
}
