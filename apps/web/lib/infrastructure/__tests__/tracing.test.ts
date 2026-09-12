import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/config/preview", () => ({
  isPreviewMode: vi.fn(() => false),
}))

vi.mock("@/lib/infrastructure/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

vi.mock("@opentelemetry/sdk-node", () => {
  const start = vi.fn()
  const shutdown = vi.fn(async () => {})
  function MockSDK(this: unknown) {
    return { start, shutdown }
  }
  const MockSDKFn = vi.fn(MockSDK)
  return { NodeSDK: MockSDKFn, _mocks: { start, shutdown, MockSDK: MockSDKFn } }
})

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: vi.fn(function (this: unknown, opts: unknown) {
    return { opts }
  }),
}))

vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: vi.fn(() => ["instrumentations"]),
}))

describe("lib/infrastructure/tracing", () => {
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ""
    process.env.OTEL_SERVICE_NAME = ""
    process.env.ENV_TYPE = "dev"
    const { resetTracingForTests } = await import("@/lib/infrastructure/tracing")
    resetTracingForTests()
    const preview = await import("@/lib/config/preview")
    vi.mocked(preview.isPreviewMode).mockReturnValue(false)
  })

  afterEach(async () => {
    process.env = { ...originalEnv }
    const mod = await import("@/lib/infrastructure/tracing")
    mod.resetTracingForTests()
    vi.clearAllMocks()
    const preview = await import("@/lib/config/preview")
    vi.mocked(preview.isPreviewMode).mockReturnValue(false)
  })

  it("does not start SDK when endpoint is empty", async () => {
    const { initTracing } = await import("@/lib/infrastructure/tracing")
    const { logger } = await import("@/lib/infrastructure/logger")
    const sdkMod = await import("@opentelemetry/sdk-node") as unknown as { _mocks: { start: ReturnType<typeof vi.fn> } }

    await initTracing("web")

    expect(sdkMod._mocks.start).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining("disabled") }))
  })

  it("skips tracing in preview mode", async () => {
    const preview = await import("@/lib/config/preview")
    vi.mocked(preview.isPreviewMode).mockReturnValue(true)
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318"

    const { initTracing } = await import("@/lib/infrastructure/tracing")
    const sdkMod = await import("@opentelemetry/sdk-node") as unknown as { _mocks: { start: ReturnType<typeof vi.fn> } }
    const { logger } = await import("@/lib/infrastructure/logger")

    await initTracing("web")

    expect(sdkMod._mocks.start).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining("preview mode") }))
  })

  it("normalizes endpoint without /v1/traces suffix", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318"
    process.env.OTEL_SERVICE_NAME = "web-test"

    const exporterMod = await import("@opentelemetry/exporter-trace-otlp-http")
    const { initTracing } = await import("@/lib/infrastructure/tracing")

    await initTracing("web")

    expect(exporterMod.OTLPTraceExporter).toHaveBeenCalledWith({ url: "http://otel:4318/v1/traces" })
  })

  it("keeps endpoint already suffixed with /v1/traces", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318/v1/traces"

    const exporterMod = await import("@opentelemetry/exporter-trace-otlp-http")
    const { initTracing } = await import("@/lib/infrastructure/tracing")

    await initTracing("web")

    expect(exporterMod.OTLPTraceExporter).toHaveBeenCalledWith({ url: "http://otel:4318/v1/traces" })
  })

  it("trims trailing slash before appending", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318/"

    const exporterMod = await import("@opentelemetry/exporter-trace-otlp-http")
    const { initTracing } = await import("@/lib/infrastructure/tracing")

    await initTracing("web")

    expect(exporterMod.OTLPTraceExporter).toHaveBeenCalledWith({ url: "http://otel:4318/v1/traces" })
  })

  it("starts SDK only once on double init", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318"

    const sdkMod = await import("@opentelemetry/sdk-node") as unknown as { _mocks: { start: ReturnType<typeof vi.fn>, MockSDK: ReturnType<typeof vi.fn> } }
    const { initTracing } = await import("@/lib/infrastructure/tracing")

    await initTracing("web")
    await initTracing("web")

    expect(sdkMod._mocks.MockSDK).toHaveBeenCalledTimes(1)
    expect(sdkMod._mocks.start).toHaveBeenCalledTimes(1)
  })

  it("shutdown is no-op when never started", async () => {
    const { shutdownTracing } = await import("@/lib/infrastructure/tracing")
    await expect(shutdownTracing()).resolves.toBeUndefined()
  })

  it("uses fallback service name when OTEL_SERVICE_NAME not set", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel:4318"
    delete process.env.OTEL_SERVICE_NAME

    const { initTracing } = await import("@/lib/infrastructure/tracing")
    const sdkMod = await import("@opentelemetry/sdk-node") as unknown as { _mocks: { MockSDK: ReturnType<typeof vi.fn> } }

    await initTracing("web-fallback")

    expect(sdkMod._mocks.MockSDK).toHaveBeenCalledWith(expect.objectContaining({ serviceName: "web-fallback" }))
  })
})
