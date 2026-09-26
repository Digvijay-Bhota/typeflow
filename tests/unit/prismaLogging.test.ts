import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@/lib/logger";
import {
  isExpectedPrismaError,
  logPrismaError,
  logPrismaWarn,
  summarizePrismaMessage,
} from "@/server/prismaLogging";

// Shapes of real Prisma 6 "error" event messages (paths and values are fake).
const UNIQUE = `
Invalid \`db.user.create()\` invocation in
/var/task/.next/server/chunks/1234.js:8:23

  5 (async () => {
→ 8   await db.user.create(
Unique constraint failed on the fields: (\`email\`)`;

const NOT_FOUND = `
Invalid \`db.user.update()\` invocation in
/var/task/.next/server/chunks/1234.js:9:23

An operation failed because it depends on one or more records that were required but not found. No record was found for an update.`;

const VALIDATION = `
Invalid \`db.user.create()\` invocation in
/var/task/.next/server/chunks/1234.js:10:23

  7 const email = "someone@example.test";
→ 10 await db.user.create({
       data: {
         email: "someone@example.test",
         displayName: "Private Person",
     +   authId: String
       }
     })

Argument \`authId\` is missing.`;

const RAW = `
Invalid \`prisma.$queryRawUnsafe()\` invocation:


Raw query failed. Code: \`42P01\`. Message: \`relation "nonexistent_table" does not exist\``;

const CONNECT = `
Invalid \`db.user.count()\` invocation in
/var/task/.next/server/chunks/1234.js:14:24

  12 const url = "postgresql://app:fake-db-pass-123@db.example.test:5432/app";
Can't reach database server at \`db.example.test:5432\`

Please make sure your database server is running at \`db.example.test:5432\`.`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summarizePrismaMessage", () => {
  it("keeps the explanation and drops the invocation, path and code frame", () => {
    expect(summarizePrismaMessage(UNIQUE)).toBe(
      "Unique constraint failed on the fields: (`email`)"
    );
    expect(summarizePrismaMessage(RAW)).toBe(
      'Raw query failed. Code: `42P01`. Message: `relation "nonexistent_table" does not exist`'
    );
    expect(summarizePrismaMessage(CONNECT)).toBe(
      "Can't reach database server at `db.example.test:5432` Please make sure your database server is running at `db.example.test:5432`."
    );
  });

  it("never includes query arguments or row values", () => {
    const summary = summarizePrismaMessage(VALIDATION);
    expect(summary).toBe("Argument `authId` is missing.");
    expect(summary).not.toContain("someone@example.test");
    expect(summary).not.toContain("Private Person");
  });

  it("never includes credentials, and bounds the length", () => {
    expect(summarizePrismaMessage(CONNECT)).not.toContain("fake-db-pass-123");
    expect(summarizePrismaMessage("Error at postgresql://u:fake-db-pass-123@h/db")).toBe(
      "Error at postgresql://[REDACTED]@h/db"
    );
    expect(summarizePrismaMessage("x".repeat(2000)).length).toBeLessThanOrEqual(501);
  });
});

describe("Prisma event logging", () => {
  it("does not log expected, handled outcomes (unique violation, record not found)", () => {
    expect(isExpectedPrismaError(UNIQUE)).toBe(true);
    expect(isExpectedPrismaError(NOT_FOUND)).toBe(true);
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    logPrismaError({ message: UNIQUE, target: "user.create" });
    logPrismaError({ message: NOT_FOUND, target: "user.update" });
    expect(error).not.toHaveBeenCalled();
  });

  it("logs other errors as a sanitized summary", () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    logPrismaError({ message: CONNECT, target: "user.count" });
    expect(error).toHaveBeenCalledWith("Prisma error", undefined, {
      prisma: {
        target: "user.count",
        message: expect.stringContaining("Can't reach database server"),
      },
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("fake-db-pass-123");
  });

  it("logs warnings", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    logPrismaWarn({ message: "Connection pool is running low" });
    expect(warn).toHaveBeenCalledWith("Prisma warning", {
      prisma: { target: undefined, message: "Connection pool is running low" },
    });
  });
});
