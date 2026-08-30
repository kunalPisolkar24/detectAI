import { z } from "zod";
import { Logger } from "@shared/logging/Logger";

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_URL_REPLICA: z.string().url().optional(),
  // Single redis:// URL, or a comma-separated host list for cluster mode
  // (e.g. "redis://a:6379,redis://b:6379"), parsed by RedisFactory.
  REDIS_URL: z.string().min(1),
  REDIS_MODE: z.enum(["standalone", "sentinel", "cluster"]).default("standalone"),
  REDIS_SENTINELS: z.string().optional(),
  REDIS_MASTER_NAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  RABBITMQ_URL: z.string().url().default("amqp://guest:guest@localhost:5672"),
  RABBITMQ_QUEUE_TYPE: z.enum(["classic", "quorum"]).default("classic"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(7777),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal("").optional()),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_TRACES_SAMPLER: z.string().optional(),
  OTEL_TRACES_SAMPLER_ARG: z.string().optional(),
});

export const createConfig = <T extends z.ZodTypeAny>(
  schema: T, 
  workerName: string
): z.infer<T> => {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    Logger.error(`Invalid environment variables for [${workerName}] worker`, {
      errors: result.error.format(),
    });
    process.exit(1);
  }

  const config = result.data;
  const safeConfig = config as Record<string, any>;

  if (safeConfig.DATABASE_URL && !safeConfig.DATABASE_URL_REPLICA) {
    safeConfig.DATABASE_URL_REPLICA = safeConfig.DATABASE_URL;
  }

  Logger.info(`Environment variables loaded for [${workerName}]`);
  return config;
};
