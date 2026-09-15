import { trace, type Tracer } from "@opentelemetry/api"

let started = false
let sdkInstance: { shutdown: () => Promise<void> } | null = null

function getOtelConfig(fallback: string): { endpoint: string; serviceName: string } {
  return {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "",
    serviceName: process.env.OTEL_SERVICE_NAME || fallback,
  }
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, "")
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`
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

  const url = normalizeEndpoint(endpoint)

  if (started) return
  started = true

  try {
    const { NodeSDK } = await import("@opentelemetry/sdk-node")
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http")
    const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node")

    const traceExporter = new OTLPTraceExporter({ url })

    const sdk = new NodeSDK({
      serviceName,
      traceExporter,
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

    try {
      const { logger } = await import("@/lib/infrastructure/logger")
      logger.info({ msg: `OTEL tracing initialized for ${serviceName} -> ${url}` })
    } catch {
      console.log(JSON.stringify({ level: "info", msg: `OTEL tracing initialized for ${serviceName} -> ${url}` }))
    }

    const shutdown = async () => {
      try {
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
}
