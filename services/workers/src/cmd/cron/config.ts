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
    REDIS_PASSWORD: true,
    NODE_ENV: true,
    PORT: true,
    OTEL_EXPORTER_OTLP_ENDPOINT: true,
    OTEL_SERVICE_NAME: true,
    OTEL_TRACES_SAMPLER: true,
    OTEL_TRACES_SAMPLER_ARG: true,
  })
  .extend({
    // Max expiry lag equals this interval (idle sleep between sweeps).
    CRON_CHECK_INTERVAL_MS: z.coerce.number().int().min(5_000).default(900_000),
    // Rows locked per sweep pass; large values hold more FOR UPDATE locks
    // and can spike payment-path latency, small values add round trips.
    CRON_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  });

export const config = createConfig(cronEnvSchema, "Cron");
