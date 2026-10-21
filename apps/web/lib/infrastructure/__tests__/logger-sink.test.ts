import { describe, it, expect, vi, beforeEach } from "vitest"

// The shared test setup replaces the logger with a stub for every other
// suite; this one needs the real pino instance.
vi.unmock("@/lib/infrastructure/logger")

vi.mock("@opentelemetry/api", async () => {
  const actual = await vi.importActual("@opentelemetry/api") as Record<string, unknown>
  return { ...actual, trace: { getActiveSpan: vi.fn(() => undefined) } }
})

type Captured = { level: string; message: string; attributes: Record<string, unknown> }

// The logger and the sink have to come from the same module registry, so both
// are imported after the reset.
async function setup() {
  vi.resetModules()
  const sink = await import("@/lib/infrastructure/logging/sink")
  const { logger } = await import("@/lib/infrastructure/logger")
  const calls: Captured[] = []
  sink.setLogSink((level, message, attributes) => {
    calls.push({ level, message, attributes })
  })
  return { logger, calls, sink }
}

describe("lib/infrastructure/logger sink forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards a structured record with its level and fields", async () => {
    const { logger, calls } = await setup()

    logger.info({ msg: "AI analysis completed", model: "spark", duration: 1250 })

    expect(calls).toHaveLength(1)
    expect(calls[0].level).toBe("info")
    expect(calls[0].message).toBe("AI analysis completed")
    expect(calls[0].attributes).toMatchObject({ model: "spark", duration: 1250 })
    expect(calls[0].attributes).not.toHaveProperty("msg")
  })

  it("maps warn and error to their own levels", async () => {
    const { logger, calls } = await setup()

    logger.warn({ msg: "cache miss", key: "k" })
    logger.error({ msg: "upstream failed", error: "boom" })

    expect(calls.map((c) => c.level)).toEqual(["warn", "error"])
    expect(calls[1].attributes).toMatchObject({ error: "boom" })
  })

  it("forwards a plain string message", async () => {
    const { logger, calls } = await setup()

    logger.info("plain message")

    expect(calls).toHaveLength(1)
    expect(calls[0].message).toBe("plain message")
    expect(calls[0].attributes).toEqual({})
  })

  it("does not throw when no sink is installed", async () => {
    const { logger, sink } = await setup()
    sink.setLogSink(null)

    expect(() => logger.error({ msg: "no sink" })).not.toThrow()
  })
})
