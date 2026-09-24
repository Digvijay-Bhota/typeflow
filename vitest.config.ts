import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Resolves + validates the test database URL before any test file (and
    // therefore any Prisma import) runs. See tests/setup/db-env.ts.
    // test-env.ts fills test-only placeholders for unset non-DB server env
    // vars (mirrors the CI test step). See tests/setup/test-env.ts.
    setupFiles: ["./tests/setup/db-env.ts", "./tests/setup/test-env.ts"],
    // Runs once before the whole suite: applies migrations and truncates
    // the test database. Independently validated — see tests/setup/global-db.ts.
    globalSetup: ["./tests/setup/global-db.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["src/features/typing/lib/**", "src/lib/**"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
