import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

export const paymentEnvSchema = baseEnvSchema
  .extend({
    PADDLE_API_KEY: z.string().min(1),
    PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).optional(),
    EVENT_REDIS_URL: z.string().url(),
    EVENT_REDIS_PASSWORD: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.RABBITMQ_URL && data.ENV_TYPE === "prod") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "RABBITMQ_URL is required in prod (no default)",
        path: ["RABBITMQ_URL"],
      });
    }
    if (!data.PADDLE_ENVIRONMENT && data.ENV_TYPE === "prod") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PADDLE_ENVIRONMENT is required in prod",
        path: ["PADDLE_ENVIRONMENT"],
      });
    }
  })
  .transform((data) => ({
    ...data,
    PADDLE_ENVIRONMENT: (data.PADDLE_ENVIRONMENT ?? "sandbox") as "sandbox" | "production",
  }));

export type PaymentsConfig = z.infer<typeof paymentEnvSchema>;

export const loadPaymentsConfig = (): Promise<PaymentsConfig> => createConfig(paymentEnvSchema, "Payments");