import { z } from "zod";

const isValidRedisUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "redis:" || u.protocol === "rediss:";
  } catch {
    return false;
  }
};

export const baseEnvSchema = z.object({
  ENV_TYPE: z.enum(["dev", "prod"]).default("dev"),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_REPLICA: z.string().url().optional(),
  REDIS_URL: z.string().min(1).refine(isValidRedisUrl, {
    message: "REDIS_URL must be a valid redis:// or rediss:// URL",
  }),
  REDIS_PASSWORD: z.string().optional(),
  RABBITMQ_URL: z.string().url().optional(),
  RABBITMQ_PREFETCH: z.coerce.number().int().min(1).max(1000).default(1),
  INFRA_REQUEUE_DELAY_MS: z.coerce.number().int().min(0).max(60000).default(5000),
  PORT: z.coerce.number().int().min(1).max(65535).default(7777),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal("").optional()),
  OTEL_SERVICE_NAME: z.string().optional(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
