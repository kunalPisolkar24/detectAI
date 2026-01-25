import pino from "pino"
import { env } from "@/lib/env"

const isDev = env.NODE_ENV === "development"

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      }
    : undefined,
  base: {
    env: env.NODE_ENV,
  },
  redact: ["password", "token", "secret", "cookie", "authorization"],
})