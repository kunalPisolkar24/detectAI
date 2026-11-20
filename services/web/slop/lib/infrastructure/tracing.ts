import { context, trace, type Tracer } from "@opentelemetry/api"
import type { LogAttributes as OtelLogAttributes } from "@opentelemetry/api-logs"
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs"
import { setLogSink, type LogLevel } from "@/lib/infrastructure/logging/sink"

let started = false
let sdkInstance: { shutdown: () => Promise<void> } | null = null

function getOtelConfig(fallback: string): { endpoint: string; serviceName: string } {
  return {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
    serviceName: process.env.OTEL_SERVICE_NAME || fallback,
  }
}

// Both signals share one endpoint. Pointing it at a signal-specific path is
// allowed, but the other signal then swaps the suffix rather than appending
// to it, which would build "/v1/logs/v1/traces".
function signalEndpoint(endpoint: string, signal: "traces" | "logs"): string {
  const base = endpoint.replace(/\/$/, "")
  if (base.endsWith(`/v1/${signal}`)) return base
  if (base.endsWith("/v1/traces") || base.endsWith("/v1/logs")) {
    return base.replace(/\/v1\/(traces|logs)$/, `/v1/${signal}`)
  }
  return `${base}/v1/${signal}`
}

export async function initTracing(serviceNameFallback = "web"): Promise<void> {
  if (started) return

  try {
    const { isPreviewMode } = await import("@/lib/config/preview")
    if (isPreviewMode()) {
      const { logger } = await import("@/lib/infrastructure/logger")
      logger.info({ msg: `OTEL tracing disabled for ${serviceNameFallback} (preview mode)` })
      return
    }
  } catch {}

  const { endpoint, serviceName } = getOtelConfig(serviceNameFallback)

  if (!endpoint) {
    try {
      const { logger } = await import("@/lib/infrastructure/logger")
      logger.info({ msg: `OTEL tracing disabled for ${serviceName} (OTEL_EXPORTER_OTLP_ENDPOINT not set)` })
    } catch {
      console.log(JSON.stringify({ level: "info", msg: `OTEL tracing disabled for ${serviceName} (OTEL_EXPORTER_OTLP_ENDPOINT not set)` }))
    }
    return
  }

  const url = signalEndpoint(endpoint, "traces")

  if (started) return
  started = true

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node")
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node")

    const traceExporter = new OTLPTraceExporter({ url })

    // Log export is optional. A missing or broken logs exporter must not take
    // tracing down with it, so it is wired separately and failures only
    // disable the logs pipeline.
    let logRecordProcessors: LogRecordProcessor[] = []
    let installLogSink: (() => void) | null = null
    try {
      const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http")
      const { BatchLogRecordProcessor } = await import("@opentelemetry/sdk-logs")
      const { logs, SeverityNumber } = await import("@opentelemetry/api-logs")

      const severities = {
        trace: SeverityNumber.TRACE,
        debug: SeverityNumber.DEBUG,
        info: SeverityNumber.INFO,
        warn: SeverityNumber.WARN,
        error: SeverityNumber.ERROR,
        fatal: SeverityNumber.FATAL,
      } as const

      logRecordProcessors = [
        new BatchLogRecordProcessor(new OTLPLogExporter({ url: signalEndpoint(endpoint, "logs") })),
      ]

      installLogSink = () => {
        const otelLogger = logs.getLogger(serviceName)
        setLogSink((level: LogLevel, message: string, attributes: Record<string, unknown>) => {
          otelLogger.emit({
            severityNumber: severities[level],
            severityText: level,
            body: message,
            attributes: attributes as unknown as OtelLogAttributes,
            // Carries the active span so New Relic can link the log to its trace.
            context: context.active(),
          })
        })
      }
    } catch (error) {
      try {
        const { logger } = await import("@/lib/infrastructure/logger")
        logger.error({
          msg: `OTEL log export disabled for ${serviceName}`,
          error: error instanceof Error ? error.message : String(error),
        })
      } catch {}
    }

    const sdk = new NodeSDK({
      serviceName,
      traceExporter,
      logRecordProcessors,
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-dns": { enabled: false },
          "@opentelemetry/instrumentation-net": { enabled: false },
        } as never),
      ],
    })

    sdk.start()

    sdkInstance = sdk as unknown as { shutdown: () => Promise<void> }

    // sdk.start() installs the global LoggerProvider, so the sink has to be
    // resolved after it returns.
    installLogSink?.()

    try {
      const { logger } = await import("@/lib/infrastructure/logger")
      logger.info({ msg: `OTEL tracing initialized for ${serviceName} -> ${url}` })
    } catch {
      console.log(JSON.stringify({ level: "info", msg: `OTEL tracing initialized for ${serviceName} -> ${url}` }))
    }

    const shutdown = async () => {
      try {
        setLogSink(null)
        await sdkInstance?.shutdown()
        try {
          const { logger } = await import("@/lib/infrastructure/logger")
          logger.info({ msg: `OTEL tracing shutdown for ${serviceName}` })
        } catch {}
      } catch {}
    }

    process.once("SIGTERM", () => void shutdown())
    process.once("SIGINT", () => void shutdown())
  } catch (error) {
    started = false
    sdkInstance = null
    try {
      const { logger } = await import("@/lib/infrastructure/logger")
      logger.error({ msg: `Failed to start OTEL tracing for ${serviceName}`, error: error instanceof Error ? error.message : String(error) })
    } catch {
      console.error(JSON.stringify({ level: "error", msg: `Failed to start OTEL tracing for ${serviceName}`, error: String(error) }))
    }
  }
}

export async function shutdownTracing(): Promise<void> {
  if (!sdkInstance) return
  try {
    setLogSink(null)
    await sdkInstance.shutdown()
  } catch {}
  sdkInstance = null
  started = false
}

export function getTracer(name = "web"): Tracer {
  return trace.getTracer(name)
}

export function resetTracingForTests(): void {
  started = false
  sdkInstance = null
  setLogSink(null)
}
