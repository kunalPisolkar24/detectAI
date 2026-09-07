import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

// Compose always exports `VAR=${VAR:-}` (empty string when unset); treat ""
// as unset so local runs without EVENT_REDIS_* fall back to REDIS_URL instead
// of crashing validation.
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

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
    EVENT_REDIS_URL: emptyToUndefined(baseEnvSchema.shape.REDIS_URL),
    EVENT_REDIS_MODE: emptyToUndefined(baseEnvSchema.shape.REDIS_MODE),
    EVENT_REDIS_SENTINELS: emptyToUndefined(baseEnvSchema.shape.REDIS_SENTINELS),
    EVENT_REDIS_MASTER_NAME: emptyToUndefined(baseEnvSchema.shape.REDIS_MASTER_NAME),
    EVENT_REDIS_PASSWORD: emptyToUndefined(baseEnvSchema.shape.REDIS_PASSWORD),
  });

export const config = createConfig(analyticsEnvSchema, "Analytics");
