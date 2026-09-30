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

    expect(db.$executeRaw).toHaveBeenCalled();
    const calls = (db.$executeRaw as any).mock.calls;

    const aCall = calls.find((c: any) => c[1] === "user-1" && c[2] === "a");
    expect(aCall).toBeDefined();

    const bCall = calls.find((c: any) => c[1] === "user-1" && c[2] === "b");
    expect(bCall).toBeDefined();

    const bErrors = bCall[3]; // stat.errors
    const bCorrected = bCall[4]; // stat.corrected
    const bTotal = bCall[5]; // stat.total
    expect(bErrors).toBe(1);
    expect(bCorrected).toBe(1);
    expect(bTotal).toBe(1);
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

    const calls = (db.$executeRaw as any).mock.calls;

    const lCall = calls.find((c: any) => c[1] === "user-2" && c[2] === "l");
    expect(lCall[3]).toBe(2); // errors
    expect(lCall[4]).toBe(1); // corrected
    expect(lCall[5]).toBe(2); // total occurrences

    const oCall = calls.find((c: any) => c[1] === "user-2" && c[2] === "o");
    expect(oCall[3]).toBe(1); // errors
    expect(oCall[4]).toBe(0); // corrected
    expect(oCall[5]).toBe(1); // total occurrences

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

    const calls = (db.$executeRaw as any).mock.calls;
    const aCall = calls.find((c: any) => c[1] === "user-repeat" && c[2] === "a");

    expect(aCall).toBeDefined();
    const errors = aCall[3];
    const corrected = aCall[4];
    const total = aCall[5];

    expect(errors).toBe(2);
    expect(corrected).toBe(2);
    expect(total).toBe(1);

    // Verify the SQL uses the corrected accuracyRate logic, rather than just recalculating it
    const sqlParts = aCall[0] as string[];
    const rawSql = sqlParts.join("?");

    // Protect against the old formula: 1.0 - (errors / totalOccurrences)
    expect(rawSql).not.toContain("GREATEST(0.0, 1.0 - (");

    // Verify the new successfulAttempts / totalAttempts logic is embedded for VALUES
    expect(rawSql).toContain(
      "LEAST(1.0, GREATEST(0.0, (? - ? + ?)::float / GREATEST(1, ? + ?)))"
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
