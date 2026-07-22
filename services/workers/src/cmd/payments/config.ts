import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

const paymentEnvSchema = baseEnvSchema.omit({
  REDIS_USAGE_URL: true,
}).extend({
  PADDLE_API_KEY: z.string().min(1),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  EVENT_REDIS_URL: z.string().url(),
  EVENT_REDIS_MODE: z.enum(["standalone", "sentinel"]).default("standalone"),
  EVENT_REDIS_SENTINELS: z.string().optional(),
  EVENT_REDIS_MASTER_NAME: z.string().optional(),
});

export const config = createConfig(paymentEnvSchema, "Payments");