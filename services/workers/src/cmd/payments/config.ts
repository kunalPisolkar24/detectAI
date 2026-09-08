import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

const paymentEnvSchema = baseEnvSchema
  .extend({
    PADDLE_API_KEY: z.string().min(1),
    PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
    EVENT_REDIS_URL: z.string().url(),
    EVENT_REDIS_MODE: z.enum(["standalone", "sentinel"]).default("standalone"),
    EVENT_REDIS_SENTINELS: z.string().optional(),
    EVENT_REDIS_MASTER_NAME: z.string().optional(),
    EVENT_REDIS_PASSWORD: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.RABBITMQ_URL && data.NODE_ENV === "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RABBITMQ_URL is required in production (no default)",
        path: ["RABBITMQ_URL"],
      });
    }
    if (!data.PADDLE_ENVIRONMENT) {
      if (data.NODE_ENV === "production") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "PADDLE_ENVIRONMENT is required in production (sandbox vs production)",
          path: ["PADDLE_ENVIRONMENT"],
        });
      }
    }
    if (data.EVENT_REDIS_MODE === "sentinel") {
      if (!data.EVENT_REDIS_SENTINELS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "EVENT_REDIS_SENTINELS is required when EVENT_REDIS_MODE=sentinel",
          path: ["EVENT_REDIS_SENTINELS"],
        });
      }
      if (!data.EVENT_REDIS_MASTER_NAME) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "EVENT_REDIS_MASTER_NAME is required when EVENT_REDIS_MODE=sentinel",
          path: ["EVENT_REDIS_MASTER_NAME"],
        });
      }
    }
  })
  .transform((data) => ({
    ...data,
    PADDLE_ENVIRONMENT: (data.PADDLE_ENVIRONMENT ?? "sandbox") as "sandbox" | "production",
  }));

export const config = createConfig(paymentEnvSchema, "Payments");