/**
 * The real Prisma client's warn/error listeners (src/server/db.ts), against
 * the local test database.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { logger } from "@/lib/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Prisma error events", () => {
  it("do not log a handled unique-constraint violation", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    const email = `prisma-log-${randomUUID()}@example.test`;
    await db.user.create({ data: { authId: randomUUID(), email } });

    await expect(
      db.user.create({ data: { authId: randomUUID(), email } })
    ).rejects.toMatchObject({ code: "P2002" });

    expect(error).not.toHaveBeenCalled();
    await db.user.delete({ where: { email } });
  });

  it("log other query failures once, as a summary without arguments or code frame", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});

    await expect(
      db.user.create({
        // @ts-expect-error missing authId, to trigger a validation error
        data: { email: "private-person@example.test", displayName: "Private Person" },
      })
    ).rejects.toThrow();
    await expect(
      db.$queryRawUnsafe("SELECT * FROM table_that_does_not_exist")
    ).rejects.toThrow();

    expect(error).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain("Argument `authId` is missing.");
    expect(logged).toContain("table_that_does_not_exist");
    expect(logged).not.toContain("private-person@example.test");
    expect(logged).not.toContain("Private Person");
    expect(logged).not.toContain("invocation in");
    expect(error.mock.calls[0]![0]).toBe("Prisma error");
  });
});
