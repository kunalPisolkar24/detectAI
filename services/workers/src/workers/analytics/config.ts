import { baseEnvSchema, createConfig } from "@shared/config";

const analyticsEnvSchema = baseEnvSchema.pick({
  DATABASE_URL: true,
  REDIS_USAGE_URL: true,
  NODE_ENV: true,
});

export const config = createConfig(analyticsEnvSchema, "Analytics");