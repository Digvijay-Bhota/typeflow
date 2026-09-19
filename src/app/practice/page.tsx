import { TypingTest } from "@/features/typing/components/TypingTest";
import { constructMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = constructMetadata({
  title: "Targeted Practice | TypeFlow",
  description: "Improve your typing by practicing your weakest keys.",
  path: "/practice",
});

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const sourceResultId =
    typeof params.sourceResultId === "string" ? params.sourceResultId : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col items-center text-center">
        <h1 className="text-3xl font-bold tracking-tight">Targeted Practice</h1>
        <p className="text-muted mt-2">
          Focusing on your weakest keys based on your recent typing data.
        </p>
      </div>

      <TypingTest
        mode="practice"
        language="english"
        wordCount={30}
        sourceResultId={sourceResultId}
        hideConfig={true}
      />
    </div>
  );
}
