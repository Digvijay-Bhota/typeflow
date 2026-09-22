/**
 * Regression coverage for the test-database isolation guards.
 *
 * These are deliberately pure-function tests: every case below validates a
 * connection *string*, so no database connection is possible at any point.
 * The two guards are implemented independently (tests/setup/db-env.ts runs
 * per worker, tests/setup/global-db.ts runs once in Vitest's main process)
 * and are therefore asserted separately rather than through a shared
 * helper — a shared helper would reintroduce the single point of failure
 * the duplication exists to avoid.
 */
import { describe, it, expect, vi } from "vitest";
import { assertSafeTestDatabaseUrl as assertWorkerGuard } from "../setup/db-env";
import {
  assertSafeTestDatabaseUrl as assertGlobalGuard,
  discoverApplicationTables,
} from "../setup/global-db";

const GUARDS: Array<[string, (name: string, raw: string) => void]> = [
  ["db-env (worker setupFiles guard)", assertWorkerGuard],
  ["global-db (globalSetup guard)", assertGlobalGuard],
];

const VALID = "postgresql://postgres:postgres@localhost:5434/typeflow_test";

describe.each(GUARDS)("%s", (_label, assertSafe) => {
  describe("accepts only loopback hosts", () => {
    it("accepts localhost", () => {
      expect(() => assertSafe("DATABASE_URL", VALID)).not.toThrow();
    });

    it("accepts 127.0.0.1", () => {
      expect(() =>
        assertSafe(
          "DATABASE_URL",
          "postgresql://postgres:postgres@127.0.0.1:5434/typeflow_test"
        )
      ).not.toThrow();
    });

    it("accepts the IPv6 loopback [::1] as URL.hostname reports it", () => {
      expect(() =>
        assertSafe(
          "DATABASE_URL",
          "postgresql://postgres:postgres@[::1]:5434/typeflow_test"
        )
      ).not.toThrow();
    });

    it("rejects a non-loopback IPv6 address", () => {
      expect(() =>
        assertSafe(
          "DATABASE_URL",
          "postgresql://postgres:postgres@[2001:db8::1]:5434/typeflow_test"
        )
      ).toThrow(/is not a local test database/);
    });

    it("rejects a Supabase pooler host", () => {
      expect(() =>
        assertSafe(
          "DATABASE_URL",
          "postgresql://postgres:pw@aws-0-ap-south-1.pooler.supabase.com:6543/typeflow_test"
        )
      ).toThrow(/is not a local test database/);
    });

    it("rejects a non-loopback IPv4 address", () => {
      expect(() =>
        assertSafe(
          "DATABASE_URL",
          "postgresql://postgres:postgres@10.0.0.5:5434/typeflow_test"
        )
      ).toThrow(/is not a local test database/);
    });
  });

  describe("rejects host/hostaddr connection-target overrides", () => {
    // Prisma honours these as the real TCP target, which would otherwise let
    // a URL whose authority says "localhost" connect to a remote database.
    it("rejects ?host=", () => {
      expect(() =>
        assertSafe("DATABASE_URL", `${VALID}?host=db.example.supabase.co`)
      ).toThrow(/host\/hostaddr override the connection target/);
    });

    it("rejects ?hostaddr=", () => {
      expect(() => assertSafe("DATABASE_URL", `${VALID}?hostaddr=203.0.113.10`)).toThrow(
        /host\/hostaddr override the connection target/
      );
    });

    it("rejects host= regardless of case", () => {
      expect(() => assertSafe("DATABASE_URL", `${VALID}?HOST=evil.example.com`)).toThrow(
        /host\/hostaddr override the connection target/
      );
      expect(() => assertSafe("DATABASE_URL", `${VALID}?HostAddr=203.0.113.10`)).toThrow(
        /host\/hostaddr override the connection target/
      );
    });

    it("rejects host= when combined with other legitimate parameters", () => {
      expect(() =>
        assertSafe("DATABASE_URL", `${VALID}?schema=public&host=evil.example.com`)
      ).toThrow(/host\/hostaddr override the connection target/);
    });

    it("still accepts legitimate query parameters", () => {
      expect(() =>
        assertSafe("DATABASE_URL", `${VALID}?schema=public&connection_limit=1`)
      ).not.toThrow();
    });
  });

  describe("database name pinning", () => {
    it("rejects a different database on localhost", () => {
      expect(() =>
        assertSafe(
          "DATABASE_URL",
          "postgresql://postgres:postgres@localhost:5434/postgres"
        )
      ).toThrow(/expected "typeflow_test"/);
    });
  });

  describe("malformed input", () => {
    it("rejects an unparseable URL", () => {
      expect(() => assertSafe("DATABASE_URL", "not-a-url")).toThrow(
        /not a valid connection URL/
      );
    });
  });

  it("applies the same rules to DIRECT_URL", () => {
    expect(() => assertSafe("DIRECT_URL", `${VALID}?host=evil.example.com`)).toThrow(
      /DIRECT_URL contains a "host" query parameter/
    );
  });
});

describe("globalSetup fails closed before any database work", () => {
  it("throws on a Supabase URL without shelling out to prisma or importing the client", async () => {
    vi.resetModules();
    const execSync = vi.fn();
    vi.doMock("node:child_process", () => ({ execSync }));
    const prismaModule = vi.fn();
    vi.doMock("@prisma/client", () => {
      prismaModule();
      return { PrismaClient: vi.fn() };
    });

    const originalUrl = process.env.DATABASE_URL;
    const originalDirect = process.env.DIRECT_URL;
    process.env.DATABASE_URL =
      "postgresql://postgres:pw@aws-0-ap-south-1.pooler.supabase.com:6543/typeflow_test";
    process.env.DIRECT_URL = process.env.DATABASE_URL;

    try {
      const { default: globalSetup } = await import("../setup/global-db");
      await expect(globalSetup()).rejects.toThrow(/is not a local test database/);
      // The guard runs before migrations and before the Prisma client is
      // even loaded, so no connection can have been attempted.
      expect(execSync).not.toHaveBeenCalled();
      expect(prismaModule).not.toHaveBeenCalled();
    } finally {
      process.env.DATABASE_URL = originalUrl;
      process.env.DIRECT_URL = originalDirect;
      vi.doUnmock("node:child_process");
      vi.doUnmock("@prisma/client");
      vi.resetModules();
    }
  });

  it("throws on a host= override without shelling out to prisma", async () => {
    vi.resetModules();
    const execSync = vi.fn();
    vi.doMock("node:child_process", () => ({ execSync }));

    const originalUrl = process.env.DATABASE_URL;
    const originalDirect = process.env.DIRECT_URL;
    process.env.DATABASE_URL = `${VALID}?host=db.example.supabase.co`;
    process.env.DIRECT_URL = process.env.DATABASE_URL;

    try {
      const { default: globalSetup } = await import("../setup/global-db");
      await expect(globalSetup()).rejects.toThrow(
        /host\/hostaddr override the connection target/
      );
      expect(execSync).not.toHaveBeenCalled();
    } finally {
      process.env.DATABASE_URL = originalUrl;
      process.env.DIRECT_URL = originalDirect;
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });
});

describe("truncate set is discovered dynamically", () => {
  function fakePrisma(rows: Array<{ table_name: string }>) {
    const queries: string[] = [];
    return {
      queries,
      client: {
        $queryRaw: (q: TemplateStringsArray, ...values: unknown[]) => {
          queries.push(q.join("?"));
          void values;
          return Promise.resolve(rows);
        },
      },
    };
  }

  it("reads BASE TABLEs from information_schema in the public schema", async () => {
    const { client, queries } = fakePrisma([
      { table_name: "users" },
      { table_name: "test_results" },
    ]);

    const tables = await discoverApplicationTables(client);

    expect(tables).toEqual(["users", "test_results"]);
    const sql = queries.join(" ");
    expect(sql).toContain("information_schema.tables");
    expect(sql).toContain("table_schema = 'public'");
    expect(sql).toContain("BASE TABLE");
    // _prisma_migrations is excluded via a bound parameter, not a literal.
    expect(sql).toContain("table_name <> ");
  });

  it("includes a newly added table without any code change", async () => {
    const { client } = fakePrisma([
      { table_name: "users" },
      { table_name: "brand_new_model" },
    ]);

    await expect(discoverApplicationTables(client)).resolves.toContain("brand_new_model");
  });

  it("fails closed when no application tables are discovered", async () => {
    const { client } = fakePrisma([]);

    await expect(discoverApplicationTables(client)).rejects.toThrow(
      /no application tables were discovered/
    );
  });

  it("fails closed when a discovered name is not a plain identifier", async () => {
    const { client } = fakePrisma([
      { table_name: "users" },
      { table_name: 'evil"; DROP TABLE users; --' },
    ]);

    await expect(discoverApplicationTables(client)).rejects.toThrow(
      /not plain identifiers/
    );
  });

  it("fails closed when discovery itself errors", async () => {
    const client = {
      $queryRaw: () => Promise.reject(new Error("connection refused")),
    };

    await expect(discoverApplicationTables(client)).rejects.toThrow(/connection refused/);
  });
});
