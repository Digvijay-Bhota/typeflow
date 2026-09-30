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
 * statement must reproduce row for row. Like the original, it runs inside a
 * transaction (it ran in the result transaction): as ~40 autocommits per
 * submission it stalled for 15+ s on a loaded machine, one WAL flush each.
 */
async function legacyAccumulate(
  client: Pick<typeof db, "$executeRaw">,
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
    await client.$executeRaw`
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
      await db.$transaction((tx) =>
        legacyAccumulate(tx, legacy.id, s.passage, s.errorMap, s.events)
      );
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
      await db.$transaction((tx) =>
        legacyAccumulate(tx, reference.id, s.passage, s.errorMap, s.events)
      );
    }

    expect(await statsOf(user.id)).toEqual(await statsOf(reference.id));
  });
});

/**
 * Persisted accuracy edge cases.
 *
 * accuracyRate is successful attempts / total attempts (PR #34), pooled over
 * every submission. The oracle below derives both by replaying the trace
 * keystroke by keystroke — independently of the SQL under test and of the
 * service's own counting:
 *
 *   attempts(k)  = positions of k reached + wrong keystrokes on k later deleted
 *   successes(k) = positions of k reached − wrong characters on k left in the
 *                  final buffer
 *
 * so a key mistyped repeatedly at one position can have more errors than
 * occurrences and still keep a well-defined accuracy.
 */
const BACKSPACE = Symbol("backspace");
type Keystroke = string | typeof BACKSPACE;

/** A trace for typing `keystrokes` in order, 100 ms apart. */
function typed(keystrokes: Keystroke[]): Event[] {
  let length = 0;
  return keystrokes.map((k, i): Event => {
    const t = (i + 1) * 100;
    if (k === BACKSPACE) return [t, 1, --length];
    return [t, 0, length++, k];
  });
}

interface Tally {
  reached: number;
  errors: number;
  corrected: number;
  wrongLeft: number;
}

/** Per expected key: what the typist did, replayed from the trace. */
function replay(passage: string, events: Event[]): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  const tally = (k: string) => {
    if (!tallies.has(k))
      tallies.set(k, { reached: 0, errors: 0, corrected: 0, wrongLeft: 0 });
    return tallies.get(k)!;
  };
  const buffer: { expected: string; ok: boolean }[] = [];
  const reached = new Set<number>();
  for (const event of events) {
    if (event[1] === 0) {
      const expected = passage[event[2]]!;
      const ok = event[3] === expected;
      if (!reached.has(event[2])) {
        reached.add(event[2]);
        tally(expected).reached += 1;
      }
      if (!ok) tally(expected).errors += 1;
      buffer.push({ expected, ok });
    } else {
      const removed = buffer.pop()!;
      if (!removed.ok) tally(removed.expected).corrected += 1;
    }
  }
  for (const { expected, ok } of buffer) if (!ok) tally(expected).wrongLeft += 1;
  return tallies;
}

/** Submits `keystrokes` against `passage` through the production path. */
async function submit(userId: string, passage: string, keystrokes: Keystroke[]) {
  const events = typed(keystrokes);
  const { keyErrors } = deriveTraceDiagnostics(passage, {
    events,
    totalEvents: events.length,
    durationMs: events.at(-1)![0],
  });
  await db.$transaction((tx) =>
    accumulateUserKeyStats(userId, passage, keyErrors as any, events, tx)
  );
  return replay(passage, events);
}

/**
 * Asserts the persisted row for `key` equals the oracle's pooled expectation
 * over `submissions`, and returns the row.
 *
 * accuracyRate is compared exactly inside Postgres: Prisma's float read-back
 * can differ from the stored double in the last digit (1/6 reads back as
 * 0.1666666666666667), so the JS value is only compared to 12 places.
 */
async function expectPersistedToMatchOracle(
  userId: string,
  key: string,
  submissions: Tally[]
) {
  const pooled = submissions.reduce(
    (sum, t) => ({
      reached: sum.reached + t.reached,
      errors: sum.errors + t.errors,
      corrected: sum.corrected + t.corrected,
      wrongLeft: sum.wrongLeft + t.wrongLeft,
    }),
    { reached: 0, errors: 0, corrected: 0, wrongLeft: 0 }
  );
  const attempts = pooled.reached + pooled.corrected;
  const successes = pooled.reached - pooled.wrongLeft;
  // A real trace can never leave the [0, 1] range, so no clamp is involved.
  expect(successes).toBeGreaterThanOrEqual(0);
  expect(successes).toBeLessThanOrEqual(attempts);
  const expectedRate = successes / attempts;

  const row = await db.userKeyStat.findUniqueOrThrow({
    where: { userId_key: { userId, key } },
  });
  expect({
    errorCount: row.errorCount,
    correctedCount: row.correctedCount,
    totalOccurrences: row.totalOccurrences,
  }).toEqual({
    errorCount: pooled.errors,
    correctedCount: pooled.corrected,
    totalOccurrences: pooled.reached,
  });
  expect(row.accuracyRate).toBeCloseTo(expectedRate, 12);

  const [stored] = await db.$queryRaw<{ exact: boolean }[]>`
    SELECT "accuracyRate" = ${successes}::float8 / ${attempts}::float8 AS "exact"
    FROM "user_key_stats" WHERE "userId" = ${userId}::uuid AND "key" = ${key}
  `;
  expect(stored?.exact).toBe(true);

  return row;
}

describe("persisted accuracyRate edge cases on Postgres", () => {
  it("repeated mistakes on one key: more errors than occurrences", async () => {
    const user = await createUser();
    // "a" mistyped three times, each fixed, then typed right; "b" typed right.
    const run = await submit(user.id, "ab", [
      "x",
      BACKSPACE,
      "y",
      BACKSPACE,
      "z",
      BACKSPACE,
      "a",
      "b",
    ]);

    const a = await expectPersistedToMatchOracle(user.id, "a", [run.get("a")!]);
    expect(a).toMatchObject({
      errorCount: 3,
      correctedCount: 3,
      totalOccurrences: 1,
      accuracyRate: 0.25, // 1 success in 4 attempts
    });

    const b = await expectPersistedToMatchOracle(user.id, "b", [run.get("b")!]);
    expect(b.accuracyRate).toBe(1);
  });

  it("corrected and uncorrected mistakes on the same key in one submission", async () => {
    const user = await createUser();
    // Position 0 fixed after a typo, position 1 left wrong, position 2 right.
    const run = await submit(user.id, "aaa", ["x", BACKSPACE, "a", "q", "a"]);

    const a = await expectPersistedToMatchOracle(user.id, "a", [run.get("a")!]);
    expect(a).toMatchObject({
      errorCount: 2,
      correctedCount: 1,
      totalOccurrences: 3,
      accuracyRate: 0.5, // 2 successes in 4 attempts
    });
  });

  it("pools every submission of a key, even once errors outnumber its occurrences", async () => {
    const user = await createUser();
    const runs: Tally[] = [];

    // 1: one "a", mistyped three times before it is right (1 of 4).
    runs.push(
      (
        await submit(user.id, "a", ["x", BACKSPACE, "y", BACKSPACE, "z", BACKSPACE, "a"])
      ).get("a")!
    );
    let a = await expectPersistedToMatchOracle(user.id, "a", runs);
    expect(a.accuracyRate).toBe(1 / 4);

    // 2: two "a"s, both left wrong — nothing succeeds (1 of 6 pooled). The
    // key now has 5 errors against 3 occurrences.
    runs.push((await submit(user.id, "aa", ["x", "y"])).get("a")!);
    a = await expectPersistedToMatchOracle(user.id, "a", runs);
    expect(a).toMatchObject({ errorCount: 5, totalOccurrences: 3 });
    expect(a.accuracyRate).toBeCloseTo(1 / 6, 12);

    // 3: four "a"s, all right (5 of 10 pooled) — pooled attempts, not the mean
    // of the three submissions' rates (0.25, 0, 1).
    runs.push((await submit(user.id, "aaaa", ["a", "a", "a", "a"])).get("a")!);
    a = await expectPersistedToMatchOracle(user.id, "a", runs);
    expect(a.accuracyRate).toBe(0.5);
    expect(a.accuracyRate).not.toBeCloseTo((0.25 + 0 + 1) / 3, 5);
  });

  it("every keystroke on a key wrong: exactly 0", async () => {
    const user = await createUser();
    const run = await submit(user.id, "aa", ["x", "y"]);

    const a = await expectPersistedToMatchOracle(user.id, "a", [run.get("a")!]);
    expect(a.accuracyRate).toBe(0);
  });

  /**
   * The clamp and denominator floor. No trace can reach them (successes stay
   * within [0, attempts], asserted above), but the error map is a separate
   * input: errors for a key with no occurrences give a negative numerator and a
   * zero denominator. The formula's normalization — clamp to [0, 1], divide by
   * at least 1 — must hold on insert and on the ON CONFLICT update, and a later
   * genuine submission must still pool normally.
   */
  it("clamps a negative numerator and floors a zero denominator, then recovers", async () => {
    const user = await createUser();
    const read = () =>
      db.userKeyStat.findUniqueOrThrow({
        where: { userId_key: { userId: user.id, key: "a" } },
      });

    // Insert: total 0, errors 2, corrected 0 → (0 − 2 + 0) / max(1, 0) → 0.
    await db.$transaction((tx) =>
      accumulateUserKeyStats(
        user.id,
        "b",
        { a: { count: 2, corrected: 0, uncorrected: 2 } },
        typed(["b"]),
        tx
      )
    );
    expect(await read()).toMatchObject({
      errorCount: 2,
      correctedCount: 0,
      totalOccurrences: 0,
      accuracyRate: 0,
    });

    // Update: total 0, errors 3, corrected 1 → (0 − 3 + 1) / max(1, 1) → 0.
    await db.$transaction((tx) =>
      accumulateUserKeyStats(
        user.id,
        "b",
        { a: { count: 1, corrected: 1, uncorrected: 0 } },
        typed(["b"]),
        tx
      )
    );
    expect(await read()).toMatchObject({
      errorCount: 3,
      correctedCount: 1,
      totalOccurrences: 0,
      accuracyRate: 0,
    });

    // Five "a"s typed right: total 5, errors 3, corrected 1 → 3 / 6.
    await submit(user.id, "aaaaa", ["a", "a", "a", "a", "a"]);
    expect(await read()).toMatchObject({
      errorCount: 3,
      correctedCount: 1,
      totalOccurrences: 5,
      accuracyRate: 0.5,
    });
  });
});
