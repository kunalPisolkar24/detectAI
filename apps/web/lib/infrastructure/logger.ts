import pino from "pino"
import { trace } from "@opentelemetry/api"
import { env } from "@/lib/config/env"

const isDev = env.NODE_ENV === "development"

function withTraceContext(): Record<string, string> {
  try {
    const span = trace.getActiveSpan()
    const ctx = span?.spanContext()
    if (ctx?.traceId) {
      return { traceId: ctx.traceId, spanId: ctx.spanId ?? "" }
    }
  } catch {}
  return {}
}

export const logger = pino({
  level: env.LOG_LEVEL || "info",
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
  mixin() {
    return withTraceContext()
  },
})