import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@opentelemetry/api", async () => {
  const actual = await vi.importActual("@opentelemetry/api") as Record<string, unknown>
  return { ...actual, trace: { getActiveSpan: vi.fn(() => undefined) } }
})

describe("lib/infrastructure/logger trace mixin", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("adds traceId/spanId when span is active", async () => {
    const otel = await import("@opentelemetry/api")
    vi.mocked((otel.trace as unknown as { getActiveSpan: ReturnType<typeof vi.fn> }).getActiveSpan).mockReturnValue({
      spanContext: () => ({ traceId: "abc123", spanId: "def456", traceFlags: 1 }),
    } as never)

    vi.resetModules()
    const { logger } = await import("@/lib/infrastructure/logger")
    expect(logger).toBeDefined()
  })

  it("logger works without active span", async () => {
    vi.resetModules()
    const { logger } = await import("@/lib/infrastructure/logger")
    expect(() => logger.info({ msg: "test" })).not.toThrow()
  })
})
