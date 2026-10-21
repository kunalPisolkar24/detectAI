import pino from "pino"
import { trace } from "@opentelemetry/api"
import { env } from "@/lib/config/env"
import { emitLog } from "@/lib/infrastructure/logging/sink"
import { createLogMethodHook } from "@/lib/infrastructure/logging/pino-hook"

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
  hooks: {
    // Mirrors every record to the OpenTelemetry log sink when one is installed.
    // stdout keeps working either way.
    logMethod: createLogMethodHook((level, message, attributes) => {
      emitLog(level, message, attributes)
    }),
  },
})
