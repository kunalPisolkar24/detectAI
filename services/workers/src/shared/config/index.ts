import { z } from "zod";
import { Logger } from "@shared/logging/Logger";

const isValidRedisUrl = (value: string): boolean => {
  // standalone: single redis:// or rediss:// URL; cluster: comma-separated list of such URLs
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    try {
      const u = new URL(part);
      return u.protocol === "redis:" || u.protocol === "rediss:";
    } catch {
      return false;
    }
  });
};

export const baseEnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    DATABASE_URL_REPLICA: z.string().url().optional(),
    // Single redis:// URL, or a comma-separated host list for cluster mode
    // (e.g. "redis://a:6379,redis://b:6379"), parsed by RedisFactory.
    REDIS_URL: z.string().min(1).refine(isValidRedisUrl, {
      message: "REDIS_URL must be a valid redis:// or rediss:// URL (comma-separated for cluster)",
    }),
    REDIS_MODE: z.enum(["standalone", "sentinel", "cluster"]).default("standalone"),
    REDIS_SENTINELS: z.string().optional(),
    REDIS_MASTER_NAME: z.string().optional(),
    REDIS_PASSWORD: z.string().optional(),
    RABBITMQ_URL: z.string().url().optional(),
    RABBITMQ_QUEUE_TYPE: z.enum(["classic", "quorum"]).default("classic"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(7777),
    POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal("").optional()),
    OTEL_SERVICE_NAME: z.string().optional(),
    OTEL_TRACES_SAMPLER: z.string().optional(),
    OTEL_TRACES_SAMPLER_ARG: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.REDIS_MODE === "sentinel") {
      if (!data.REDIS_SENTINELS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "REDIS_SENTINELS is required when REDIS_MODE=sentinel",
          path: ["REDIS_SENTINELS"],
        });
      }
      if (!data.REDIS_MASTER_NAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "REDIS_MASTER_NAME is required when REDIS_MODE=sentinel",
          path: ["REDIS_MASTER_NAME"],
        });
      }
    }
    if (data.REDIS_MODE === "cluster" && data.REDIS_URL) {
      const parts = data.REDIS_URL.split(",").filter(Boolean);
      if (parts.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "REDIS_URL should contain multiple comma-separated URLs when REDIS_MODE=cluster",
          path: ["REDIS_URL"],
        });
      }
    }
    if (!data.RABBITMQ_URL && data.NODE_ENV === "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RABBITMQ_URL is required in production (no default)",
        path: ["RABBITMQ_URL"],
      });
    }
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

  const config = result.data as Record<string, any>;

  // Apply safe defaults that were made optional for strict validation
  if (!config.RABBITMQ_URL) {
    config.RABBITMQ_URL = "amqp://guest:guest@localhost:5672";
    if (config.NODE_ENV === "production") {
      // already caught by superRefine, but keep for type safety
    } else {
      Logger.warn(`RABBITMQ_URL not set, using default for ${config.NODE_ENV}`, { workerName });
    }
  }

  if (config.DATABASE_URL && !config.DATABASE_URL_REPLICA) {
    config.DATABASE_URL_REPLICA = config.DATABASE_URL;
    Logger.info(`DATABASE_URL_REPLICA not set, falling back to DATABASE_URL for [${workerName}]`);
  }

  // Normalize POOL_MAX default (10) — actual Pool creation reads env directly, but keep config consistent
  if (!config.POOL_MAX) {
    config.POOL_MAX = 10;
  }

  Logger.info(`Environment variables loaded for [${workerName}]`);
  return config as z.infer<T>;
};
