import { z } from "zod";
import { CODE_LANGUAGES, LANGUAGES, TEST_DURATIONS, TYPING_MODES } from "@/lib/constants";

/** Query-string integers: "60" → 60, rejects "abc", "1.5", "". */
const queryInt = z
  .string()
  .regex(/^\d+$/, "Must be a non-negative integer")
  .transform((v) => Number(v));

/**
 * GET /api/leaderboard query parameters. Every value that reaches a SQL enum
 * cast is checked here, so malformed input is a 400, never a database error.
 */
export const LeaderboardQuerySchema = z.object({
  period: z.enum(["daily", "weekly", "all-time"]).default("all-time"),
  mode: z.enum(TYPING_MODES).optional(),
  language: z.enum(LANGUAGES).optional(),
  codeLanguage: z.enum(CODE_LANGUAGES).optional(),
  duration: queryInt
    .refine((d) => (TEST_DURATIONS as readonly number[]).includes(d), {
      message: `Duration must be one of ${TEST_DURATIONS.join(", ")} seconds`,
    })
    .optional(),
  limit: queryInt.refine((n) => n >= 1 && n <= 100, "Limit must be 1–100").optional(),
  offset: queryInt.refine((n) => n <= 10_000, "Offset must be at most 10000").optional(),
});

export type LeaderboardQueryInput = z.infer<typeof LeaderboardQuerySchema>;

/** URLSearchParams → plain object, treating empty values as absent. */
export function leaderboardParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (value !== "") params[key] = value;
  }
  return params;
}
