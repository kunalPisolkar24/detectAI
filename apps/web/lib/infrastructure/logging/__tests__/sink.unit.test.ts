import { describe, it, expect, beforeEach } from "vitest"
import { emitLog, setLogSink } from "../sink"

describe("lib/infrastructure/logging/sink", () => {
  beforeEach(() => {
    setLogSink(null)
  })

  it("is a no-op when no sink is installed", () => {
    expect(() => emitLog("info", "hello", {})).not.toThrow()
  })

  it("forwards level, message and attributes to the sink", () => {
    const calls: Array<[string, string, Record<string, unknown>]> = []
    setLogSink((level, message, attributes) => {
      calls.push([level, message, attributes])
    })

    emitLog("error", "boom", { code: 500 })

    expect(calls).toEqual([["error", "boom", { code: 500 }]])
  })

  it("stops forwarding once the sink is detached", () => {
    const calls: string[] = []
    setLogSink((_level, message) => {
      calls.push(message)
    })

    emitLog("info", "first", {})
    setLogSink(null)
    emitLog("info", "second", {})

    expect(calls).toEqual(["first"])
  })

  it("swallows sink errors so a failing exporter cannot take a request down", () => {
    setLogSink(() => {
      throw new Error("exporter down")
    })

    expect(() => emitLog("info", "hello", {})).not.toThrow()
  })
})
