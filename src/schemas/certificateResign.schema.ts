import { z } from "zod";

/**
 * Body of POST /api/cron/resign-legacy-certificates (one-off maintenance).
 * Only the mode can be chosen: the certificates are hard-coded in the
 * service, and any other field (e.g. certificate ids) is rejected.
 */
export const certificateResignRequestSchema = z
  .object({
    mode: z.enum(["dry-run", "apply", "rollback"]).default("dry-run"),
  })
  .strict();

export type CertificateResignRequest = z.infer<typeof certificateResignRequestSchema>;
