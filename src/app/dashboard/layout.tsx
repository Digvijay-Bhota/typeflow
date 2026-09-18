import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { redirect } from "next/navigation";
import { constructMetadata } from "@/lib/seo";

export const metadata = constructMetadata({
  title: "Dashboard",
  description: "Your personal TypeFlow dashboard",
  path: "/dashboard",
  noindex: true,
});

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
      {children}
    </div>
  );
}
