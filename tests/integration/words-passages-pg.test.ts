/**
 * Words tests are served passages long enough for their target, against a
 * real Postgres:
 *
 * - the data migration adds the long NORMAL passages and corrects overstated
 *   stored word counts, idempotently;
 * - session creation serves a words test of every offered length only a
 *   passage with at least that many words — judged by the text, so a row whose
 *   stored count is wrong is never served;
 * - an unsupported word count is rejected, and timed tests are unaffected.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/server/db";
import { POST as createRoute } from "@/app/api/session/create/route";
import { englishPassages } from "@/features/typing/lib/passages";
import { countWords } from "@/features/typing/lib/wordLimit";
import { WORD_COUNTS } from "@/lib/constants";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));

const MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20260930000000_words_mode_passages/migration.sql"
);

/** The migration's statements (the passage text contains no semicolons). */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, "utf8")
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function applyMigration() {
  for (const statement of migrationStatements()) {
    await db.$executeRawUnsafe(statement);
  }
}

const longPassages = englishPassages.filter((p) => p.id.startsWith("en-long-"));

// Existing databases before the migration: short passages stored with
// overstated word counts, as the seed wrote them.
const OVERSTATED = {
  content: "A short passage whose stored word count was overstated by the seed.",
  wordCount: 50,
};
// Only three words, whatever its row says.
const MISLABELLED = "Three words only.";

const createWordsSession = async (wordCount: number) =>
  createRoute(
    new Request("http://localhost/api/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "words", language: "english", wordCount }),
    })
  );

beforeAll(async () => {
  for (const { content, wordCount } of [
    OVERSTATED,
    { content: MISLABELLED, wordCount: 500 },
  ]) {
    await db.passage.create({
      data: { content, wordCount, charCount: content.length, mode: "NORMAL" },
    });
  }
});

describe("data migration", () => {
  it("adds every long passage, active, with correct counts", async () => {
    await applyMigration();

    for (const p of longPassages) {
      const rows = await db.passage.findMany({ where: { content: p.content } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        mode: "NORMAL",
        language: "ENGLISH",
        difficulty: "INTERMEDIATE",
        category: p.category,
        isActive: true,
        wordCount: countWords(p.content),
        charCount: p.content.length,
      });
      expect(rows[0]!.wordCount).toBeGreaterThanOrEqual(Math.max(...WORD_COUNTS));
    }
  });

  it("corrects overstated stored word counts to the text's", async () => {
    for (const content of [OVERSTATED.content, MISLABELLED]) {
      const row = await db.passage.findFirstOrThrow({ where: { content } });
      expect(row.wordCount).toBe(countWords(content));
      expect(row.isActive).toBe(true);
    }
  });

  it("is idempotent", async () => {
    await applyMigration();
    for (const p of longPassages) {
      expect(await db.passage.count({ where: { content: p.content } })).toBe(1);
    }
  });
});

describe("words session passage selection", () => {
  beforeAll(async () => {
    // A row whose stored count is wrong again (say, edited by hand): the
    // service must judge the text, not the column.
    await db.passage.updateMany({
      where: { content: MISLABELLED },
      data: { wordCount: 500 },
    });
  });

  it.each(WORD_COUNTS.map((n) => [n] as const))(
    "serves a %i-word test only passages with at least that many words",
    async (n) => {
      for (let i = 0; i < 15; i++) {
        const res = await createWordsSession(n);
        expect(res.status).toBe(201);
        const session = await res.json();
        expect(session.wordCount).toBe(n);
        expect(countWords(session.passage.content)).toBeGreaterThanOrEqual(n);
        expect(session.passage.content).not.toBe(MISLABELLED);
      }
    }
  );

  it("rejects a word count the product does not offer", async () => {
    const res = await createWordsSession(300);
    expect(res.status).toBe(400);
  });

  it("still serves timed tests from the whole NORMAL pool", async () => {
    const res = await createRoute(
      new Request("http://localhost/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "timed", language: "english", duration: 60 }),
      })
    );
    expect(res.status).toBe(201);
  });
});
