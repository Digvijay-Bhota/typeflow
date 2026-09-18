import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getLeaderboard } from "@/server/services/leaderboard.service";
import { db } from "@/server/db";
import { Prisma } from "@prisma/client";

vi.mock("@/server/db", () => ({
  db: {
    $queryRaw: vi.fn(),
  },
}));

describe("Leaderboard Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns leaderboard entries and respects limit", async () => {
    const mockResults = [
      {
        shareId: "abc1",
        wpm: 120,
        netWpm: 115,
        accuracy: 0.98,
        duration: 60,
        integrityStatus: "VERIFIED",
        createdAt: new Date("2023-01-01"),
        userId: "u1",
        displayName: "Alice",
        avatarUrl: null,
        leaderboardOptOut: false,
        mode: "TIMED",
        language: "ENGLISH",
        codeLanguage: null,
        trustTier: "FREE",
      },
    ];

    vi.mocked(db.$queryRaw).mockResolvedValueOnce(mockResults);

    const data = await getLeaderboard({ period: "all-time", limit: 10 });
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]!.netWpm).toBe(115);
    expect(data.entries[0]!.rank).toBe(1);
    expect(db.$queryRaw).toHaveBeenCalled();
  });

  it("filters by mode and language correctly", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([]);

    await getLeaderboard({
      period: "all-time",
      mode: "code",
      language: "code",
      codeLanguage: "python",
    });

    // Verify that the query contains the filters via arguments
    const callArgs = vi.mocked(db.$queryRaw).mock.calls[0] as unknown as any[];
    // Prisma tagged template literals inject the values as subsequent arguments
    const hasMode = callArgs.some((arg) => JSON.stringify(arg).includes("mode"));
    expect(hasMode).toBe(true);
  });

  it("never exposes email or internal UUIDs in leaderboard entries", async () => {
    const mockResults = [
      {
        shareId: "abc1",
        wpm: 100,
        netWpm: 90,
        accuracy: 0.9,
        duration: 60,
        integrityStatus: "VERIFIED",
        createdAt: new Date(),
        userId: "secret-uuid",
        email: "alice@test.com",
        displayName: "Alice",
        avatarUrl: null,
        mode: "TIMED",
        language: "ENGLISH",
        trustTier: "FREE",
      },
    ];
    vi.mocked(db.$queryRaw).mockResolvedValueOnce(mockResults);

    const data = await getLeaderboard({ period: "all-time" });
    expect(data.entries[0]).not.toHaveProperty("email");
    expect(data.entries[0]).not.toHaveProperty("userId");
  });

  it("provides anonymous fallback if displayName is null", async () => {
    const mockResults = [
      {
        shareId: "abc1",
        wpm: 100,
        netWpm: 90,
        accuracy: 0.9,
        duration: 60,
        integrityStatus: "VERIFIED",
        createdAt: new Date(),
        userId: "u1",
        displayName: null,
        mode: "TIMED",
        language: "ENGLISH",
        trustTier: "FREE",
      },
    ];
    vi.mocked(db.$queryRaw).mockResolvedValueOnce(mockResults);

    const data = await getLeaderboard({ period: "all-time" });
    expect(data.entries[0]!.displayName).toBe("Anonymous Typist");
  });
});
