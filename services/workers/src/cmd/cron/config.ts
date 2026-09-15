import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

export const cronEnvSchema = baseEnvSchema.extend({
  CRON_CHECK_INTERVAL_MS: z.coerce.number().int().min(5_000).default(900_000),
  CRON_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
});

export type CronConfig = z.infer<typeof cronEnvSchema>;

export const loadCronConfig = (): Promise<CronConfig> => createConfig(cronEnvSchema, "Cron");
