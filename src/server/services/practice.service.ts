import { db } from "@/server/db";
import { Language, PassageMode } from "@prisma/client";
import { createHash } from "crypto";

function generateDeterministicUuid(input: string): string {
  const hash = createHash("md5").update(input).digest("hex");
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    "3" + hash.substring(13, 16),
    "8" + hash.substring(17, 20),
    hash.substring(20, 32),
  ].join("-");
}

export async function generateTargetedPassage(
  language: Language,
  weakKeys: string[],
  wordCount: number = 30
) {
  // Enforce maximum of 5 targeted keys
  const limitedKeys = weakKeys.slice(0, 5);
  // Sort weak keys to ensure deterministic attribution matching and bounds limit
  const sortedKeys = [...limitedKeys].map((k) => k.toLowerCase()).sort();
  const attribution = `Generated for weak keys: ${sortedKeys.join(",")}`;

  // Deterministic ID allows safe concurrent requests via DB unique constraint
  const passageId = generateDeterministicUuid(attribution + language);

  // Check if we already have a practice passage for these exact keys
  const existing = await db.passage.findUnique({
    where: { id: passageId },
  });

  if (existing) {
    return existing;
  }

  // 1. Fetch base words from existing passages
  const sourcePassages = await db.passage.findMany({
    where: { language, mode: "NORMAL", isActive: true },
    take: 50,
  });

  if (sourcePassages.length === 0) {
    throw new Error("No source passages available to generate practice.");
  }

  // 2. Build a word pool
  const allWords = new Set<string>();
  sourcePassages.forEach((p) => {
    const words = p.content.split(/\s+/);
    words.forEach((w) => {
      // Keep basic lowercase words, remove punctuation to keep it clean
      const cleanWord = w.replace(/[^\w-]/g, "").toLowerCase();
      if (cleanWord.length > 0) {
        allWords.add(cleanWord);
      }
    });
  });

  const wordPool = Array.from(allWords);

  // 3. Filter words that contain weak keys
  let targetedWords = wordPool.filter((w) =>
    sortedKeys.some((key) => w.includes(key))
  );

  // If we don't have enough targeted words, fallback to the general pool
  if (targetedWords.length < 10) {
    targetedWords = wordPool;
  }

  // 4. Generate the new passage
  const generatedWords: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    const randomWord =
      targetedWords[Math.floor(Math.random() * targetedWords.length)] || "practice";
    generatedWords.push(randomWord);
  }

  const content = generatedWords.join(" ");

  // 5. Save the generated passage (handles concurrent creation safely)
  try {
    const passage = await db.passage.create({
      data: {
        id: passageId,
        content,
        language,
        category: "targeted_practice",
        difficulty: "INTERMEDIATE",
        mode: "PRACTICE" as PassageMode,
        wordCount: generatedWords.length,
        charCount: content.length,
        isActive: true,
        sourceAttribution: attribution,
      },
    });
    return passage;
  } catch (e: any) {
    if (e.code === "P2002") {
      // Unique constraint failed, meaning another concurrent request created it
      return await db.passage.findUniqueOrThrow({ where: { id: passageId } });
    }
    throw e;
  }
}
