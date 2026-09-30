/**
 * Persistent key stats are written in one statement, against a real Postgres.
 *
 * accumulateUserKeyStats runs inside the result transaction. It used to issue
 * one upsert per distinct key (~30 for a one-minute test, ~45 for a
 * certificate test), each a round trip holding the transaction open. It now
 * writes every key with one INSERT … SELECT FROM unnest(…) ON CONFLICT. These
 * tests pin that the rows are exactly what the per-key upserts produced, and
 * that atomicity, lock ordering and escaping hold.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { accumulateUserKeyStats } from "@/server/services/practice.service";
import { deriveTraceDiagnostics } from "@/features/typing/lib/traceAnalysis";
import { englishPassages } from "@/features/typing/lib/passages";
import type { EventTrace } from "@/schemas/result.schema";

type Event = EventTrace["events"][number];

async function createUser() {
  return db.user.create({
    data: {
      id: randomUUID(),
      email: `key-stats-${randomUUID()}@x.com`,
      authId: randomUUID(),
    },
  });
}

/** Types `text` correctly, with a fixed typo every `typoEvery` characters. */
function traceFor(text: string, typoEvery = 13): Event[] {
  const events: Event[] = [];
  let t = 0;
  for (let i = 0; i < text.length; i++) {
    if (i % typoEvery === 5) {
      events.push([(t += 90), 0, i, "#"], [(t += 90), 1, i]);
    }
    events.push([(t += 90), 0, i, text[i]!]);
  }
  return events;
}

function submission(passage: string, typedLength: number) {
  const events = traceFor(passage.slice(0, typedLength));
  const { keyErrors } = deriveTraceDiagnostics(passage, {
    events,
    totalEvents: events.length,
    durationMs: events.at(-1)![0],
  });
  return { passage, events, errorMap: keyErrors as any };
}

/**
 * The per-key upsert this change replaced, verbatim: the reference the single
 * statement must reproduce row for row.
 */
async function legacyAccumulate(
  userId: string,
  passageContent: string,
  errorMap: Record<string, { count: number; corrected: number }>,
  events: Event[]
) {
  let maxIndex = -1;
  for (const event of events)
    if (event[1] === 0 && event[2] > maxIndex) maxIndex = event[2];
  const stats = new Map<string, { total: number; errors: number; corrected: number }>();
  for (const char of passageContent.slice(0, maxIndex + 1)) {
    const stat = stats.get(char) ?? { total: 0, errors: 0, corrected: 0 };
    stat.total += 1;
    stats.set(char, stat);
  }
  for (const [char, err] of Object.entries(errorMap)) {
    const stat = stats.get(char) ?? { total: 0, errors: 0, corrected: 0 };
    stat.errors += err.count || 0;
    stat.corrected += err.corrected || 0;
    stats.set(char, stat);
  }
  for (const key of Array.from(stats.keys())
    .filter((k) => k.length <= 10)
    .sort()) {
    const stat = stats.get(key)!;
    if (stat.total === 0 && stat.errors === 0) continue;
    await db.$executeRaw`
      INSERT INTO "user_key_stats" (id, "userId", "key", "errorCount", "correctedCount", "totalOccurrences", "accuracyRate", "updatedAt")
      VALUES (gen_random_uuid(), ${userId}::uuid, ${key}, ${stat.errors}, ${stat.corrected}, ${stat.total},
              LEAST(1.0, GREATEST(0.0, (${stat.total} - ${stat.errors} + ${stat.corrected})::float / GREATEST(1, ${stat.total} + ${stat.corrected}))), now())
      ON CONFLICT ("userId", "key") DO UPDATE
      SET "errorCount" = "user_key_stats"."errorCount" + EXCLUDED."errorCount",
          "correctedCount" = "user_key_stats"."correctedCount" + EXCLUDED."correctedCount",
          "totalOccurrences" = "user_key_stats"."totalOccurrences" + EXCLUDED."totalOccurrences",
          "accuracyRate" = LEAST(1.0, GREATEST(0.0,
            (("user_key_stats"."totalOccurrences" + EXCLUDED."totalOccurrences") - ("user_key_stats"."errorCount" + EXCLUDED."errorCount") + ("user_key_stats"."correctedCount" + EXCLUDED."correctedCount"))::float
            / GREATEST(1, ("user_key_stats"."totalOccurrences" + EXCLUDED."totalOccurrences") + ("user_key_stats"."correctedCount" + EXCLUDED."correctedCount"))
          )),
          "updatedAt" = now();
    `;
  }
}

async function statsOf(userId: string) {
  const rows = await db.userKeyStat.findMany({
    where: { userId },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => ({
    key: r.key,
    errorCount: r.errorCount,
    correctedCount: r.correctedCount,
    totalOccurrences: r.totalOccurrences,
    accuracyRate: r.accuracyRate,
  }));
}

const LONG = englishPassages.find((p) => p.id.startsWith("en-long-"))!.content;

describe("accumulateUserKeyStats on Postgres", () => {
  it("writes exactly the rows the per-key upserts wrote, on insert and on update", async () => {
    const [current, legacy] = [await createUser(), await createUser()];
    const submissions = [
      submission(LONG, 300), // a one-minute test
      submission(LONG, LONG.length), // the whole passage: new keys and conflicts
      submission("hello", 5),
    ];

    for (const s of submissions) {
      await db.$transaction((tx) =>
        accumulateUserKeyStats(current.id, s.passage, s.errorMap, s.events, tx)
      );
      await legacyAccumulate(legacy.id, s.passage, s.errorMap, s.events);
    }

    const rows = await statsOf(current.id);
    expect(rows.length).toBeGreaterThan(25);
    expect(rows.some((r) => r.errorCount > 0 && r.correctedCount > 0)).toBe(true);
    expect(rows).toEqual(await statsOf(legacy.id));
  });

  it("writes every key in a single statement", async () => {
    const user = await createUser();
    const s = submission(LONG, LONG.length);
    const executeRaw = vi.fn();

    await db.$transaction(async (tx) => {
      const counted = {
        $executeRaw: (...args: Parameters<typeof tx.$executeRaw>) => {
          executeRaw();
          return tx.$executeRaw(...args);
        },
      };
      await accumulateUserKeyStats(user.id, s.passage, s.errorMap, s.events, counted);
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(await statsOf(user.id)).toHaveLength(new Set(LONG).size);
  });

  it("stores keys that are significant in SQL or array syntax exactly", async () => {
    const user = await createUser();
    const passage = `a'b"c\\d,e{f}g h(NULL)é€`;
    const s = submission(passage, passage.length);

    await db.$transaction((tx) =>
      accumulateUserKeyStats(user.id, s.passage, s.errorMap, s.events, tx)
    );

    const keys = (await statsOf(user.id)).map((r) => r.key).sort();
    expect(keys).toEqual([...new Set(passage)].sort());
  });

  it("writes nothing without a trace", async () => {
    const user = await createUser();
    const executeRaw = vi.fn();
    await accumulateUserKeyStats(user.id, "abc", {}, [], { $executeRaw: executeRaw });
    await accumulateUserKeyStats(user.id, "abc", {}, null, { $executeRaw: executeRaw });
    expect(executeRaw).not.toHaveBeenCalled();
    expect(await statsOf(user.id)).toEqual([]);
  });

  it("rolls back with the result transaction", async () => {
    const user = await createUser();
    const s = submission(LONG, 300);

    await expect(
      db.$transaction(async (tx) => {
        await accumulateUserKeyStats(user.id, s.passage, s.errorMap, s.events, tx);
        throw new Error("result write failed");
      })
    ).rejects.toThrow("result write failed");

    expect(await statsOf(user.id)).toEqual([]);
  });

  it("neither deadlocks nor loses updates when one user's submissions overlap", async () => {
    const [user, reference] = [await createUser(), await createUser()];
    // Overlapping key sets, each transaction held open after its write so the
    // row locks of all of them contend.
    const submissions = [120, 300, 600, LONG.length, 450, 90].map((n) =>
      submission(LONG, n)
    );

    await Promise.all(
      submissions.map((s) =>
        db.$transaction(
          async (tx) => {
            await accumulateUserKeyStats(user.id, s.passage, s.errorMap, s.events, tx);
            await tx.$executeRaw`SELECT pg_sleep(0.05)`;
          },
          { timeout: 20_000, maxWait: 20_000 }
        )
      )
    );
    for (const s of submissions) {
      await legacyAccumulate(reference.id, s.passage, s.errorMap, s.events);
    }

    expect(await statsOf(user.id)).toEqual(await statsOf(reference.id));
  });
});
