import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  accumulateUserKeyStats,
  getPersistentWeakKeys,
} from "@/server/services/practice.service";
import { db } from "@/server/db";

vi.mock("@/server/db", () => ({
  db: {
    $executeRaw: vi.fn(),
    userKeyStat: {
      findMany: vi.fn(),
    },
  },
}));

/**
 * The single upsert's parameters, per key: accumulateUserKeyStats writes every
 * key in one statement, with parallel arrays [keys, errors, corrected, totals].
 */
function rowsWritten(userId: string) {
  const calls = (db.$executeRaw as any).mock.calls.filter((c: any) => c[1] === userId);
  expect(calls).toHaveLength(1);
  const [sqlParts, , keys, errors, corrected, totals] = calls[0];
  const rows: Record<string, { errors: number; corrected: number; total: number }> = {};
  (keys as string[]).forEach((key, i) => {
    rows[key] = { errors: errors[i], corrected: corrected[i], total: totals[i] };
  });
  return { rows, keys: keys as string[], sql: (sqlParts as string[]).join("?") };
}

describe("Phase 9: Progress & Adaptive Foundation (Mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accumulate user key stats robustly using eventTrace", async () => {
    const passage = "ab";
    const errorMap = {
      b: { expected: "b", count: 1, corrected: 1, uncorrected: 0 },
    };

    // Trace: correct 'a', wrong 'b', backspace, stop
    const events = [
      [100, 0, 0, "a"], // type 'a' correctly at index 0
      [200, 0, 1, "x"], // type wrong char 'x' at index 1
      [300, 1, 1], // backspace at index 1
    ];

    await accumulateUserKeyStats("user-1", passage, errorMap, events, db);

    const { rows } = rowsWritten("user-1");
    expect(rows.a).toBeDefined();
    expect(rows.b).toEqual({ errors: 1, corrected: 1, total: 1 });
  });

  it("should handle multiple repeated keys and uncorrected mistakes", async () => {
    const passage = "hello"; // h, e, l, l, o
    const errorMap = {
      l: { expected: "l", count: 2, corrected: 1, uncorrected: 1 },
      o: { expected: "o", count: 1, corrected: 0, uncorrected: 1 },
    };

    // index 0: 'h' (correct)
    // index 1: 'e' (correct)
    // index 2: 'l' (wrong -> correct)
    // index 3: 'l' (wrong -> uncorrected)
    // index 4: 'o' (wrong -> uncorrected)
    const events = [
      [10, 0, 0, "h"],
      [20, 0, 1, "e"],
      [30, 0, 2, "x"], // wrong for 'l'
      [40, 1, 2], // backspace
      [50, 0, 2, "l"], // correct 'l'
      [60, 0, 3, "x"], // wrong for second 'l'
      [70, 0, 4, "p"], // wrong for 'o'
    ];

    await accumulateUserKeyStats("user-2", passage, errorMap, events, db);

    const { rows, keys } = rowsWritten("user-2");
    expect(rows.l).toEqual({ errors: 2, corrected: 1, total: 2 });
    expect(rows.o).toEqual({ errors: 1, corrected: 0, total: 1 });
    // Written in sorted key order (the lock order that prevents deadlocks).
    expect(keys).toEqual(["e", "h", "l", "o"]);

    // Verify no zero-denominator rows
    // Every call must have totalOccurrences >= 0. Since we filter stat.total === 0 && stat.errors === 0,
    // if total is 0 but errors > 0, it still processes. The SQL query uses GREATEST(1, total) for the denominator.
  });

  it("should not accumulate stats if trace events are absent", async () => {
    await accumulateUserKeyStats("user-3", "test", {}, null, db);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("should handle repeated wrong attempts at one passage position", async () => {
    const passage = "a";
    const errorMap = {
      a: { expected: "a", count: 2, corrected: 2, uncorrected: 0 },
    };
    const events = [
      [100, 0, 0, "x"], // wrong 1
      [200, 1, 0], // backspace
      [300, 0, 0, "y"], // wrong 2
      [400, 1, 0], // backspace
      [500, 0, 0, "a"], // correct
    ];

    await accumulateUserKeyStats("user-repeat", passage, errorMap, events, db);

    const { rows, sql: rawSql } = rowsWritten("user-repeat");
    expect(rows.a).toEqual({ errors: 2, corrected: 2, total: 1 });

    // Verify the SQL uses the corrected accuracyRate logic, rather than just recalculating it

    // Protect against the old formula: 1.0 - (errors / totalOccurrences)
    expect(rawSql).not.toContain("GREATEST(0.0, 1.0 - (");

    // Verify the new successfulAttempts / totalAttempts logic is embedded for new rows
    expect(rawSql).toContain(
      'LEAST(1.0, GREATEST(0.0, (v."total" - v."errors" + v."corrected")::float / GREATEST(1, v."total" + v."corrected")))'
    );

    // Verify the DO UPDATE SET clause also uses the new semantics
    expect(rawSql).toContain('"accuracyRate" = LEAST(1.0, GREATEST(0.0,');
    expect(rawSql).toContain(
      '("user_key_stats"."totalOccurrences" + EXCLUDED."totalOccurrences") - ("user_key_stats"."errorCount" + EXCLUDED."errorCount") + ("user_key_stats"."correctedCount" + EXCLUDED."correctedCount")'
    );
  });

  it("should get persistent weak keys sensibly", async () => {
    (db.userKeyStat.findMany as any).mockResolvedValueOnce([
      { key: "z", errorCount: 8, accuracyRate: 0.2, totalOccurrences: 10 },
      { key: "y", errorCount: 2, accuracyRate: 0.9, totalOccurrences: 20 },
    ]);

    const weakKeys = await getPersistentWeakKeys("user-1", 5);
    expect(weakKeys).toEqual(["z", "y"]);
  });
});
