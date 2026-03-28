import { baseEnvSchema, createConfig } from "@shared/config";

const analyticsEnvSchema = baseEnvSchema.pick({
  DATABASE_URL: true,
  DATABASE_URL_REPLICA: true,
  REDIS_USAGE_URL: true,
  REDIS_USAGE_MODE: true,
  REDIS_URL: true,
  REDIS_MODE: true,
  REDIS_SENTINELS: true,
  REDIS_MASTER_NAME: true,
  NODE_ENV: true,
  PORT: true,
});

export const config = createConfig(analyticsEnvSchema, "Analytics");
