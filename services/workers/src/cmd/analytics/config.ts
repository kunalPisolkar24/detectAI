import { baseEnvSchema, createConfig } from "@shared/config";

const analyticsEnvSchema = baseEnvSchema
  .pick({
    DATABASE_URL: true,
    DATABASE_URL_REPLICA: true,
    REDIS_URL: true,
    REDIS_MODE: true,
    REDIS_SENTINELS: true,
    REDIS_MASTER_NAME: true,
    REDIS_PASSWORD: true,
    RABBITMQ_URL: true,
    NODE_ENV: true,
    PORT: true,
    OTEL_EXPORTER_OTLP_ENDPOINT: true,
    OTEL_SERVICE_NAME: true,
  })
  .extend({
    EVENT_REDIS_URL: baseEnvSchema.shape.REDIS_URL.optional(),
    EVENT_REDIS_MODE: baseEnvSchema.shape.REDIS_MODE.optional(),
    EVENT_REDIS_SENTINELS: baseEnvSchema.shape.REDIS_SENTINELS.optional(),
    EVENT_REDIS_MASTER_NAME: baseEnvSchema.shape.REDIS_MASTER_NAME.optional(),
    EVENT_REDIS_PASSWORD: baseEnvSchema.shape.REDIS_PASSWORD.optional(),
  });

export const config = createConfig(analyticsEnvSchema, "Analytics");
