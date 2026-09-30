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
  let targetedWords = wordPool.filter((w) => sortedKeys.some((key) => w.includes(key)));

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

/**
 * Accumulate user key stats from a validated event trace.
 * - events are expected to be an already validated event trace.
 * - the caller must validate the trace with reconstructFinalBuffer().
 * - maxIndex is therefore safe to use for encountered passage positions.
 */
export async function accumulateUserKeyStats(
  userId: string,
  passageContent: string,
  errorMap: Record<string, { count: number; corrected: number; uncorrected: number }>,
  events: any[] | null,
  txClient: any = db
) {
  // If no trace is available, we cannot safely and authoritatively account for key occurrences.
  // We explicitly fallback to skipping accumulation to avoid persisting misleading data.
  if (!events || events.length === 0) {
    return;
  }

  let maxIndex = -1;
  for (const event of events) {
    const type = event[1];
    const index = event[2];
    if (type === 0 && index > maxIndex) {
      maxIndex = index;
    }
  }

  if (maxIndex < 0 || maxIndex >= passageContent.length) {
    maxIndex = Math.min(maxIndex, passageContent.length - 1);
  }

  const typedPassage = passageContent.slice(0, maxIndex + 1);

  const stats = new Map<string, { total: number; errors: number; corrected: number }>();

  for (const char of typedPassage) {
    if (!stats.has(char)) {
      stats.set(char, { total: 0, errors: 0, corrected: 0 });
    }
    stats.get(char)!.total += 1;
  }

  for (const [char, err] of Object.entries(errorMap)) {
    if (!stats.has(char)) {
      stats.set(char, { total: 0, errors: 0, corrected: 0 });
    }
    const stat = stats.get(char)!;
    stat.errors += err.count || 0;
    stat.corrected += err.corrected || 0;
  }

  // To prevent deadlocks in concurrent updates, sort keys before updating
  const sortedKeys = Array.from(stats.keys())
    .filter((k) => k.length <= 10)
    .sort();

  for (const key of sortedKeys) {
    const stat = stats.get(key)!;
    if (stat.total === 0 && stat.errors === 0) continue;

    await txClient.$executeRaw`
      INSERT INTO "user_key_stats" (id, "userId", "key", "errorCount", "correctedCount", "totalOccurrences", "accuracyRate", "updatedAt")
      VALUES (gen_random_uuid(), ${userId}::uuid, ${key}, ${stat.errors}, ${stat.corrected}, ${stat.total},
              GREATEST(0.0, 1.0 - (${stat.errors}::float / GREATEST(1, ${stat.total}))), now())
      ON CONFLICT ("userId", "key") DO UPDATE
      SET "errorCount" = "user_key_stats"."errorCount" + EXCLUDED."errorCount",
          "correctedCount" = "user_key_stats"."correctedCount" + EXCLUDED."correctedCount",
          "totalOccurrences" = "user_key_stats"."totalOccurrences" + EXCLUDED."totalOccurrences",
          "accuracyRate" = GREATEST(0.0, 1.0 - (("user_key_stats"."errorCount" + EXCLUDED."errorCount")::float / GREATEST(1, "user_key_stats"."totalOccurrences" + EXCLUDED."totalOccurrences"))),
          "updatedAt" = now();
    `;
  }
}

export async function getPersistentWeakKeys(
  userId: string,
  limit: number = 5
): Promise<string[]> {
  const stats = await db.userKeyStat.findMany({
    where: { userId, totalOccurrences: { gte: 10 } },
    orderBy: [{ accuracyRate: "asc" }, { errorCount: "desc" }, { key: "asc" }],
    take: limit,
  });

  return stats.map((s) => s.key);
}
