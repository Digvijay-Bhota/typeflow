import { describe, it, expect, vi, beforeEach } from "vitest";
import { getHistory, getDashboardStats, getAnalyticsData } from "@/server/services/dashboard.service";
import { db } from "@/server/db";
import * as authService from "@/server/services/auth.service";

vi.mock("@/server/db", () => ({
  db: {
    testResult: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/services/auth.service", () => ({
  requireAuthenticatedUser: vi.fn(),
}));

describe("Dashboard Service Integration (Cursor Pagination & Authorization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getHistory (Cursor Pagination & Filters)", () => {
    it("should fetch the first page without a cursor and return nextCursor if more results exist", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);

      const mockResults = Array.from({ length: 21 }).map((_, i) => ({
        id: `result-${21 - i}`,
        createdAt: new Date(`2026-01-0${((21 - i) % 9) + 1}T10:00:00Z`),
        userId: "user-1",
      }));

      vi.mocked(db.testResult.findMany).mockResolvedValue(mockResults as any);

      const res = await getHistory(undefined, undefined, 20);

      expect(db.testResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          take: 21,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      );

      expect(res.results.length).toBe(20);
      expect(res.nextCursor).not.toBeNull();
      expect(res.nextCursor?.id).toBe("result-2");
    });

    it("should apply mode and language filters", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);
      vi.mocked(db.testResult.findMany).mockResolvedValue([] as any);

      await getHistory(undefined, undefined, 20, { mode: "CODE", language: "typescript" });

      expect(db.testResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-1",
            session: {
              mode: "CODE",
              codeLanguage: "typescript"
            }
          }),
        })
      );
    });

    it("should apply dateRange filters", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);
      vi.mocked(db.testResult.findMany).mockResolvedValue([] as any);

      await getHistory(undefined, undefined, 20, { dateRange: "7" });

      expect(db.testResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-1",
            createdAt: { gte: expect.any(Date) }
          }),
        })
      );
    });

    it("should fetch subsequent pages using the cursor", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);
      vi.mocked(db.testResult.findMany).mockResolvedValue([] as any);

      const cursorCreatedAt = new Date("2026-01-01T10:00:00Z").toISOString();
      await getHistory("result-2", cursorCreatedAt, 20);

      expect(db.testResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user-1",
            OR: [
              { createdAt: { lt: expect.any(Date) } },
              { createdAt: expect.any(Date), id: { lt: "result-2" } },
            ],
          }),
        })
      );
    });
  });

  describe("getDashboardStats", () => {
    it("should fetch aggregated stats filtered only for the authenticated user", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);
      vi.mocked(db.testResult.aggregate).mockResolvedValue({
        _count: { id: 10 },
        _avg: { wpm: 80, accuracy: 0.95 },
        _max: { wpm: 120 },
      } as any);
      vi.mocked(db.testResult.findMany).mockResolvedValue([] as any);

      const stats = await getDashboardStats();

      expect(db.testResult.aggregate).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        _count: { id: true },
        _avg: { wpm: true, accuracy: true },
        _max: { wpm: true },
        _sum: { elapsedMs: true, totalKeystrokes: true },
      });

      expect(stats.totalTests).toBe(10);
      expect(stats.avgWpm).toBe(80);
      expect(stats.maxWpm).toBe(120);
    });
  });

  describe("getAnalyticsData (Scalable Aggregation & Timezone Hardening)", () => {
    it("should aggregate data via raw SQL", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);

      vi.mocked(db.$queryRaw).mockResolvedValue([
        { date: new Date("2026-01-01"), avgWpm: 50, maxWpm: 60, avgAccuracy: 0.9, count: 5 }
      ] as any);

      const res = await getAnalyticsData("ENGLISH", "30");

      expect(db.$queryRaw).toHaveBeenCalled();
      expect(res.data).toHaveLength(1);
      expect(res.data[0]?.wpm).toBe(50);
    });

    it("should handle valid, invalid, and missing timezones safely", async () => {
      vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({
        id: "user-1",
      } as any);

      vi.mocked(db.$queryRaw).mockResolvedValue([]);

      await getAnalyticsData("ENGLISH", "30", "Asia/Kolkata");
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);

      await getAnalyticsData("ENGLISH", "30", "Invalid/Timezone");
      // Since it's invalid, it should fall back to UTC inside the query instead of crashing Postgres.
      expect(db.$queryRaw).toHaveBeenCalledTimes(2);

      await getAnalyticsData("ENGLISH", "30", "");
      expect(db.$queryRaw).toHaveBeenCalledTimes(3);
    });
  });
});
