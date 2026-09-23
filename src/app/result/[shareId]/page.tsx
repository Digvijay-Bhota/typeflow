import React from "react";
import { notFound } from "next/navigation";
import { db as prisma } from "@/server/db";
import { ResultClient } from "@/features/analytics/components/ResultClient";

import { getPublicResult } from "@/features/analytics/lib/publicResult";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const result = await prisma.testResult.findUnique({
    where: { shareId },
    include: {
      session: {
        select: {
          mode: true,
          language: true,
          codeLanguage: true,
          trustTier: true,
          duration: true,
          passage: {
            select: {
              sourceAttribution: true,
            },
          },
        },
      },
    },
  });

  if (!result) {
    notFound();
  }

  let comparison: any = null;

  if (result.session.mode === "PRACTICE" && result.userId) {
    const recent = await prisma.testResult.findMany({
      where: {
        userId: result.userId,
        createdAt: { lt: result.createdAt },
        session: {
          mode: { not: "PRACTICE" },
          language: result.session.language,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (recent.length > 0) {
      const avgWpm = recent.reduce((sum, r) => sum + r.wpm, 0) / recent.length;
      const avgAcc = recent.reduce((sum, r) => sum + r.accuracy, 0) / recent.length;

      comparison = {
        beforeWpm: Math.round(avgWpm),
        beforeAccuracy: Math.round(avgAcc * 100),
      };
    }
  }

  const publicResult = getPublicResult(result);

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <ResultClient result={publicResult} comparison={comparison} />
      </div>
    </div>
  );
}
