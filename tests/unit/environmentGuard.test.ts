/**
 * Environment isolation guard (src/lib/environmentGuard.ts) and where it is
 * enforced (getServerEnv, the Prisma singleton, rateLimit).
 *
 * All values are fake. The "production" project ref, hosts and keys below
 * only have the SHAPE of real ones.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertEnvironmentIsolation,
  deploymentEnvironment,
  environmentIsolationViolations,
  EnvironmentIsolationError,
} from "@/lib/environmentGuard";
import { __clearServerEnvForTesting, getServerEnv } from "@/lib/env";

const PROD_REF = "prodref0000000000001";
const STAGING_REF = "stagref0000000000002";
const DB_PASSWORD = "pw-SECRET-db-password-DO-NOT-LOG";

const prodPooledDb = `postgresql://postgres.${PROD_REF}:${DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
const prodDirectDb = `postgresql://postgres:${DB_PASSWORD}@db.${PROD_REF}.supabase.co:5432/postgres`;
const stagingPooledDb = `postgresql://postgres.${STAGING_REF}:${DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
const stagingDirectDb = `postgresql://postgres:${DB_PASSWORD}@db.${STAGING_REF}.supabase.co:5432/postgres`;
const localDb = `postgresql://postgres:${DB_PASSWORD}@localhost:5432/typeflow_dev`;

const LIVE_KEY = "rzp_live_SECRETLIVEKEY01";
const TEST_KEY = "rzp_test_FAKETESTKEY01";

/** Production as deployed today: production project, live keys, production URL. */
const productionEnv = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "typeflow.example.com",
  NODE_ENV: "production",
  DATABASE_URL: prodPooledDb,
  DIRECT_URL: prodDirectDb,
  SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  RAZORPAY_KEY_ID: LIVE_KEY,
  NEXT_PUBLIC_RAZORPAY_KEY_ID: LIVE_KEY,
  APP_URL: "https://typeflow.example.com",
  NEXT_PUBLIC_APP_URL: "https://typeflow.example.com",
};

/** A correctly isolated preview: staging project, Test Mode keys, preview URL. */
const isolatedPreviewEnv = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_PROJECT_PRODUCTION_URL: "typeflow.example.com",
  NODE_ENV: "production",
  PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
  DATABASE_URL: stagingPooledDb,
  DIRECT_URL: stagingDirectDb,
  SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  RAZORPAY_KEY_ID: TEST_KEY,
  NEXT_PUBLIC_RAZORPAY_KEY_ID: TEST_KEY,
  APP_URL: "https://typeflow-git-feature-x-team.vercel.app",
  NEXT_PUBLIC_APP_URL: "https://typeflow-git-feature-x-team.vercel.app",
};

/** Local `next dev` against a local Postgres. */
const localDevelopmentEnv = {
  NODE_ENV: "development",
  DATABASE_URL: localDb,
  DIRECT_URL: localDb,
  SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  RAZORPAY_KEY_ID: TEST_KEY,
  APP_URL: "http://localhost:3000",
};

const variables = (env: Record<string, string | undefined>) =>
  environmentIsolationViolations(env).map((v) => v.variable);

/** process.env of a preview still configured with production values. */
function stubMisconfiguredPreview() {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PRODUCTION_SUPABASE_PROJECT_REF", PROD_REF);
  vi.stubEnv("DATABASE_URL", prodPooledDb);
  vi.stubEnv("DIRECT_URL", prodDirectDb);
  vi.stubEnv("RAZORPAY_KEY_ID", LIVE_KEY);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __clearServerEnvForTesting();
});

describe("deploymentEnvironment", () => {
  it.each([
    [{ VERCEL_ENV: "production", NODE_ENV: "production" }, "production"],
    [{ VERCEL_ENV: "preview", NODE_ENV: "production" }, "preview"],
    [{ VERCEL_ENV: "development", NODE_ENV: "development" }, "development"],
    // An unknown Vercel environment (e.g. a custom one) is never production.
    [{ VERCEL_ENV: "staging", NODE_ENV: "production" }, "preview"],
    // VERCEL_ENV wins over NODE_ENV: a preview cannot pass as test.
    [{ VERCEL_ENV: "preview", NODE_ENV: "test" }, "preview"],
    [{ NODE_ENV: "production" }, "production"],
    [{ NODE_ENV: "development" }, "development"],
    [{ NODE_ENV: "test" }, "test"],
    [{}, "development"],
  ] as const)("%o -> %s", (env, expected) => {
    expect(deploymentEnvironment(env)).toBe(expected);
  });
});

describe("A. production configuration is accepted", () => {
  it("on Vercel production, with the production project, live keys and production URL", () => {
    expect(environmentIsolationViolations(productionEnv)).toEqual([]);
    expect(() => assertEnvironmentIsolation(productionEnv)).not.toThrow();
  });

  it("in a production build outside Vercel (CI), without VERCEL_ENV", () => {
    const { VERCEL: _v, VERCEL_ENV: _e, ...ciBuild } = productionEnv;
    expect(environmentIsolationViolations(ciBuild)).toEqual([]);
  });

  it("in the test environment, which has its own database guards", () => {
    expect(
      environmentIsolationViolations({
        ...productionEnv,
        VERCEL: undefined,
        VERCEL_ENV: undefined,
        NODE_ENV: "test",
      })
    ).toEqual([]);
  });
});

describe("B. a non-production runtime on the production database is rejected", () => {
  it.each([
    ["pooled (postgres.<ref> user)", prodPooledDb],
    ["direct (db.<ref>.supabase.co host)", prodDirectDb],
  ])("rejects a %s production DATABASE_URL and DIRECT_URL", (_label, prodDb) => {
    const env = { ...isolatedPreviewEnv, DATABASE_URL: prodDb, DIRECT_URL: prodDb };
    expect(variables(env)).toEqual(["DATABASE_URL", "DIRECT_URL"]);
    expect(() => assertEnvironmentIsolation(env)).toThrow(EnvironmentIsolationError);
  });

  it("fails closed on a remote database when the production ref is not declared", () => {
    const { PRODUCTION_SUPABASE_PROJECT_REF: _r, ...env } = isolatedPreviewEnv;
    expect(variables(env)).toEqual(
      expect.arrayContaining(["DATABASE_URL", "DIRECT_URL", "SUPABASE_URL"])
    );
  });

  it("rejects today's shared configuration on a preview (production values everywhere)", () => {
    const shared = { ...productionEnv, VERCEL_ENV: "preview" };
    expect(variables(shared)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "DIRECT_URL",
        "SUPABASE_URL",
        "RAZORPAY_KEY_ID",
        "APP_URL",
      ])
    );
  });

  it("rejects a production database in local development too", () => {
    expect(variables({ ...localDevelopmentEnv, DATABASE_URL: prodPooledDb })).toEqual([
      "DATABASE_URL",
    ]);
  });

  it("treats a libpq host= override as remote, and an unparseable URL as invalid", () => {
    expect(
      variables({
        ...localDevelopmentEnv,
        DIRECT_URL: `${localDb}?host=db.${PROD_REF}.supabase.co`,
      })
    ).toEqual(["DIRECT_URL"]);
    expect(
      environmentIsolationViolations({
        ...localDevelopmentEnv,
        DATABASE_URL: "not a url",
      })
    ).toEqual([{ variable: "DATABASE_URL", problem: "is not a valid URL" }]);
  });

  it("rejects a malformed PRODUCTION_SUPABASE_PROJECT_REF instead of trusting it", () => {
    const env = { ...isolatedPreviewEnv, PRODUCTION_SUPABASE_PROJECT_REF: "not-a-ref" };
    expect(variables(env)).toContain("PRODUCTION_SUPABASE_PROJECT_REF");
  });

  it("rejects the production Supabase API URL when the production ref is declared", () => {
    expect(
      variables({ ...localDevelopmentEnv, PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF })
    ).toEqual(["SUPABASE_URL"]);
  });
});

describe("C. non-production with Test Mode keys and its own infrastructure is accepted", () => {
  it("an isolated preview (staging project, rzp_test_ keys, preview URL)", () => {
    expect(environmentIsolationViolations(isolatedPreviewEnv)).toEqual([]);
  });

  it("local development against a local Postgres, without any extra configuration", () => {
    expect(environmentIsolationViolations(localDevelopmentEnv)).toEqual([]);
    expect(
      environmentIsolationViolations({
        ...localDevelopmentEnv,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5434/typeflow_dev",
      })
    ).toEqual([]);
  });

  it("branch and deployment preview URLs, and previews without VERCEL_PROJECT_PRODUCTION_URL", () => {
    expect(
      variables({
        ...isolatedPreviewEnv,
        APP_URL: "https://typeflow-abc123-team.vercel.app",
      })
    ).toEqual([]);
    const { VERCEL_PROJECT_PRODUCTION_URL: _p, ...noProdUrl } = isolatedPreviewEnv;
    expect(variables(noProdUrl)).toEqual([]);
  });
});

describe("D. non-production live Razorpay keys are rejected", () => {
  it.each(["RAZORPAY_KEY_ID", "NEXT_PUBLIC_RAZORPAY_KEY_ID"])("%s", (name) => {
    const env = { ...isolatedPreviewEnv, [name]: LIVE_KEY };
    expect(environmentIsolationViolations(env)).toEqual([
      { variable: name, problem: "is not a Razorpay Test Mode key (rzp_test_…)" },
    ]);
  });

  it("in local development as well", () => {
    expect(variables({ ...localDevelopmentEnv, RAZORPAY_KEY_ID: LIVE_KEY })).toEqual([
      "RAZORPAY_KEY_ID",
    ]);
  });
});

describe("APP_URL", () => {
  it.each(["APP_URL", "NEXT_PUBLIC_APP_URL"])(
    "rejects the production domain as a preview's %s",
    (name) => {
      const env = { ...isolatedPreviewEnv, [name]: "https://TypeFlow.example.com/path" };
      expect(environmentIsolationViolations(env)).toEqual([
        { variable: name, problem: "is the production URL" },
      ]);
    }
  );

  it("accepts VERCEL_PROJECT_PRODUCTION_URL given with a protocol", () => {
    const env = {
      ...isolatedPreviewEnv,
      VERCEL_PROJECT_PRODUCTION_URL: "https://typeflow.example.com",
      APP_URL: "https://typeflow.example.com",
    };
    expect(variables(env)).toEqual(["APP_URL"]);
  });
});

describe("Supabase API URL", () => {
  it("a deployed preview fails closed on a remote project when the production ref is not declared", () => {
    const { PRODUCTION_SUPABASE_PROJECT_REF: _r, ...env } = isolatedPreviewEnv;
    expect(variables({ ...env, DATABASE_URL: localDb, DIRECT_URL: localDb })).toEqual([
      "SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("accepts a local Supabase and rejects an invalid URL", () => {
    expect(
      variables({ ...localDevelopmentEnv, SUPABASE_URL: "http://localhost:54321" })
    ).toEqual([]);
    expect(variables({ ...localDevelopmentEnv, SUPABASE_URL: "::nope" })).toEqual([
      "SUPABASE_URL",
    ]);
  });
});

describe("enforcement points", () => {
  it("getServerEnv() refuses a misconfigured preview, and caches nothing", () => {
    stubMisconfiguredPreview();
    __clearServerEnvForTesting();
    expect(() => getServerEnv()).toThrow(EnvironmentIsolationError);
    // Still refused on the next call: the failed configuration was not cached.
    expect(() => getServerEnv()).toThrow(EnvironmentIsolationError);
  });

  it("getServerEnv() accepts the test environment unchanged", () => {
    __clearServerEnvForTesting();
    expect(getServerEnv().NODE_ENV).toBe("test");
  });

  it("the Prisma singleton refuses to load in a misconfigured preview", async () => {
    stubMisconfiguredPreview();
    vi.resetModules();
    try {
      await expect(import("@/server/db")).rejects.toThrow(/Configuration Error/);
    } finally {
      vi.resetModules();
    }
  });

  it("rateLimit() surfaces the error instead of silently failing closed", async () => {
    stubMisconfiguredPreview();
    __clearServerEnvForTesting();
    const { rateLimit } = await import("@/server/middleware/rateLimit");
    // The db test above reset the module registry, so rateLimit loads its own
    // copy of the guard module: match the error by name, not by class.
    await expect(rateLimit("guard-probe", 1, 1000)).rejects.toMatchObject({
      name: "EnvironmentIsolationError",
      message: expect.stringMatching(/^Configuration Error: refusing to run a preview/),
    });
  });
});

describe("G. errors and logs never contain credential values", () => {
  it("names variables only", () => {
    const env = {
      ...productionEnv,
      VERCEL_ENV: "preview",
      PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
      RAZORPAY_KEY_SECRET: "rzp-key-secret-DO-NOT-LOG",
    };
    let message = "";
    try {
      assertEnvironmentIsolation(env);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^Configuration Error: refusing to run a preview deployment/);
    for (const value of [
      DB_PASSWORD,
      prodPooledDb,
      prodDirectDb,
      PROD_REF,
      LIVE_KEY,
      "rzp-key-secret-DO-NOT-LOG",
      "typeflow.example.com",
      "pooler.supabase.com",
    ]) {
      expect(message).not.toContain(value);
    }
  });

  it("writes nothing to the console or stdout when refusing", () => {
    const spies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(process.stdout, "write").mockImplementation(() => true),
    ];
    stubMisconfiguredPreview();
    __clearServerEnvForTesting();
    expect(() => getServerEnv()).toThrow(EnvironmentIsolationError);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
