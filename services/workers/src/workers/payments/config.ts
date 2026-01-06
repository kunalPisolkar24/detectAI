import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

const paymentEnvSchema = baseEnvSchema.extend({
  PADDLE_API_KEY: z.string().min(1),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
});

export const config = createConfig(paymentEnvSchema, "Payments");