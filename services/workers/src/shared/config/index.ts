import { z } from "zod";
import { Logger } from "../logger";

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_URL_REPLICA: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  REDIS_USAGE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().url().default("amqp://guest:guest@localhost:5672"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(7777),
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