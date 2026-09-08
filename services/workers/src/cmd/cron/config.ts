import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

// NOTE: baseEnvSchema carries refinements, and zod v4 forbids `.pick()` on
// refined object schemas — extend it instead. Unknown env vars are stripped
// by safeParse, so keeping the full base is harmless.
const cronEnvSchema = baseEnvSchema.extend({
  // Max expiry lag equals this interval (idle sleep between sweeps).
  CRON_CHECK_INTERVAL_MS: z.coerce.number().int().min(5_000).default(900_000),
  // Rows locked per sweep pass; large values hold more FOR UPDATE locks
  // and can spike payment-path latency, small values add round trips.
  CRON_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
});

export const config = createConfig(cronEnvSchema, "Cron");
