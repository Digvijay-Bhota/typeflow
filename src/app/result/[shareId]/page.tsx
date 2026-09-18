import React from "react";
import { notFound } from "next/navigation";
import { db as prisma } from "@/server/db";
import { ResultClient } from "@/features/analytics/components/ResultClient";

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
        },
      },
    },
  });

  if (!result) {
    notFound();
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <ResultClient result={result} />
      </div>
    </div>
  );
}
