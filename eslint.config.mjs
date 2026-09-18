import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** @type {import("eslint").Linter.Config[]} */
const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Enforce no `any` (with exceptions for documented cases)
      "@typescript-eslint/no-explicit-any": "warn",

      // Prevent unused variables (catches dead code)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Prevent console in production (use logger instead)
      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],

      // Prevent React import (not needed in React 17+)
      "react/react-in-jsx-scope": "off",

      // Prefer const
      "prefer-const": "error",

      // No var
      "no-var": "error",
    },
  },
  {
    // Relax rules in test files
    files: ["tests/**/*.ts", "tests/**/*.tsx", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
