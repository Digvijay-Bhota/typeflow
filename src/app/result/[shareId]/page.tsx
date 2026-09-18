import React from "react";
import { notFound } from "next/navigation";
import { db as prisma } from "@/server/db";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { ResultClient } from "@/features/analytics/components/ResultClient";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const result = await prisma.testResult.findUnique({
    where: { shareId },
    include: { session: { select: { mode: true, language: true, codeLanguage: true, trustTier: true, duration: true } } }
  });

  if (!result) {
    notFound();
  }

  const user = await getAuthenticatedUser();
  const isOwner = user?.id === result.userId;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <ResultClient result={result} isOwner={isOwner} />
      </div>
    </div>
  );
}
