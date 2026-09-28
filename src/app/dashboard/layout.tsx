import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { redirect } from "next/navigation";
import { constructMetadata } from "@/lib/seo";
import { Container } from "@/components/ui";
import { DashboardNav } from "@/components/shell/DashboardNav";

export const metadata = constructMetadata({
  title: "Dashboard",
  description: "Your personal TypeFlow dashboard",
  path: "/dashboard",
  noindex: true,
});

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <Container size="wide" className="flex flex-1 flex-col gap-8 py-8">
      <DashboardNav />
      <div className="flex flex-1 flex-col">{children}</div>
    </Container>
  );
}
