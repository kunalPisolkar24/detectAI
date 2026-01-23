import { baseEnvSchema, createConfig } from "@shared/config";

const cronEnvSchema = baseEnvSchema.pick({
  DATABASE_URL: true,
  DATABASE_URL_REPLICA: true,
  REDIS_URL: true,
  NODE_ENV: true,
});

export const config = createConfig(cronEnvSchema, "Cron");