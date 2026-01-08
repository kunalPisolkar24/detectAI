import { z } from "zod";
import { Logger } from "../logger";

export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REDIS_USAGE_URL: z.string().url(),
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

  Logger.info(`Environment variables loaded for [${workerName}]`);
  return result.data;
};