import { z } from "zod";
import { baseEnvSchema, createConfig } from "@shared/config";

// NOTE: baseEnvSchema carries refinements, and zod v4 forbids `.pick()` on
// refined object schemas — use the full base instead. Unknown env vars are
// stripped by safeParse, so the extra fields are harmless. Analytics needs
// DATABASE_URL, REDIS_* (cache), RABBITMQ_URL, and PORT from the base;
// EVENT_REDIS_* is intentionally absent (redis-events is Paddle-only).
const analyticsEnvSchema = baseEnvSchema.superRefine((data, ctx) => {
  if (!data.RABBITMQ_URL && data.NODE_ENV === "production") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "RABBITMQ_URL is required in production (no default)",
      path: ["RABBITMQ_URL"],
    });
  }
});

export const config = createConfig(analyticsEnvSchema, "Analytics");
