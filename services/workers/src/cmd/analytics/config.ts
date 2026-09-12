import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

export const analyticsEnvSchema = baseEnvSchema.superRefine((data, ctx) => {
  if (!data.RABBITMQ_URL && data.ENV_TYPE === "prod") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "RABBITMQ_URL is required in prod",
      path: ["RABBITMQ_URL"],
    });
  }
});

export type AnalyticsConfig = z.infer<typeof analyticsEnvSchema>;

export const loadAnalyticsConfig = (): Promise<AnalyticsConfig> => createConfig(analyticsEnvSchema, "Analytics");
