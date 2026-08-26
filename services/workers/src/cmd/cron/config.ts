import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

const cronEnvSchema = baseEnvSchema
  .pick({
    DATABASE_URL: true,
    DATABASE_URL_REPLICA: true,
    REDIS_URL: true,
    REDIS_MODE: true,
    REDIS_SENTINELS: true,
    REDIS_MASTER_NAME: true,
    NODE_ENV: true,
    PORT: true,
  })
  .extend({
    // Max expiry lag equals this interval (idle sleep between sweeps).
    CRON_CHECK_INTERVAL_MS: z.coerce.number().int().min(5_000).default(900_000),
  });

export const config = createConfig(cronEnvSchema, "Cron");
