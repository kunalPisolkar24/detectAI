import { describe, it, expect, vi, beforeEach } from "vitest"

// The shared test setup replaces the logger with a stub; this suite needs the
// real one so the pino hook actually reaches the sink.
vi.unmock("@/lib/infrastructure/logger")

const { emitted } = vi.hoisted(() => ({ emitted: [] as Array<Record<string, unknown>> }))

vi.mock("@opentelemetry/api-logs", () => ({
  logs: {
    getLogger: vi.fn(() => ({
      emit: vi.fn((record: Record<string, unknown>) => {
        emitted.push(record)
      }),
    })),
  },
  SeverityNumber: { TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 },
}))

vi.mock("@/lib/config/preview", () => ({
  isPreviewMode: vi.fn(() => false),
}))

vi.mock("@opentelemetry/sdk-node", () => {
  const start = vi.fn()
  const shutdown = vi.fn(async () => {})
  function MockSDK(this: unknown) {
    return { start, shutdown }
  }
  return { NodeSDK: vi.fn(MockSDK) }
})

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: vi.fn(function (this: unknown) {
    return {}
  }),
}))

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: vi.fn(function (this: unknown) {
    return {}
  }),
}))

vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: vi.fn(function (this: unknown) {
    return {}
  }),
}))

describe("lib/infrastructure/tracing log export", () => {
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    emitted.length = 0
    vi.clearAllMocks()
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318"
    process.env.OTEL_SERVICE_NAME = "web-test"
    const { resetTracingForTests } = await import("@/lib/infrastructure/tracing")
    resetTracingForTests()
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    const { resetTracingForTests } = await import("@/lib/infrastructure/tracing")
    resetTracingForTests()
    vi.clearAllMocks()
  })

  it("exports log records through the OTLP sink", async () => {
    const { initTracing } = await import("@/lib/infrastructure/tracing")
    const { logger } = await import("@/lib/infrastructure/logger")

    await initTracing("web")
    logger.error({ msg: "boom", code: 500 })

    const record = emitted.find((r) => r.body === "boom")
    expect(record).toBeDefined()
    expect(record?.severityNumber).toBe(17)
    expect(record?.severityText).toBe("error")
    expect(record?.attributes).toMatchObject({ code: 500 })
  })

  it("points the log exporter at the /v1/logs endpoint", async () => {
    const exporter = await import("@opentelemetry/exporter-logs-otlp-http")
    const { initTracing } = await import("@/lib/infrastructure/tracing")

    await initTracing("web")

    expect(exporter.OTLPLogExporter).toHaveBeenCalledWith({ url: "http://otel:4318/v1/logs" })
  })

  it("keeps a /v1/logs endpoint unchanged", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318/v1/logs"
    const exporter = await import("@opentelemetry/exporter-logs-otlp-http")
    const traceExporter = await import("@opentelemetry/exporter-trace-otlp-http")
    const { initTracing } = await import("@/lib/infrastructure/tracing")

    await initTracing("web")

    expect(exporter.OTLPLogExporter).toHaveBeenCalledWith({ url: "http://otel:4318/v1/logs" })
    // The trace exporter must not append to a signal-specific path.
    expect(traceExporter.OTLPTraceExporter).toHaveBeenCalledWith({ url: "http://otel:4318/v1/traces" })
  })

  it("detaches the sink on shutdown", async () => {
    const { initTracing, shutdownTracing } = await import("@/lib/infrastructure/tracing")
    const { logger } = await import("@/lib/infrastructure/logger")

    await initTracing("web")
    await shutdownTracing()
    emitted.length = 0

    logger.error({ msg: "after shutdown" })

    expect(emitted).toHaveLength(0)
  })

  it("installs no sink when tracing is disabled", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ""
    const { initTracing } = await import("@/lib/infrastructure/tracing")
    const { logger } = await import("@/lib/infrastructure/logger")

    await initTracing("web")
    emitted.length = 0
    logger.error({ msg: "no collector" })

    expect(emitted).toHaveLength(0)
  })
})
