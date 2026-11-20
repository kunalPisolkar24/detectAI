import { describe, it, expect } from "vitest"
import { Writable } from "node:stream"
import pino from "pino"
import { createLogMethodHook, splitArgs } from "../pino-hook"

describe("lib/infrastructure/logging/pino-hook", () => {
  it("splits a structured record into message and attributes", () => {
    const { message, attributes } = splitArgs([{ msg: "hello", userId: "u1", count: 3 }])

    expect(message).toBe("hello")
    expect(attributes).toEqual({ userId: "u1", count: 3 })
  })

  it("treats a plain string as the message", () => {
    expect(splitArgs(["plain"])).toEqual({ message: "plain", attributes: {} })
  })

  it("keeps the second string as the message when the record has none", () => {
    expect(splitArgs([{ a: 1 }, "override"]).message).toBe("override")
  })

  it("describes an Error argument", () => {
    const { message, attributes } = splitArgs([new Error("boom")])

    expect(message).toBe("boom")
    expect(attributes).toEqual({ error: "boom" })
  })

  it("maps pino levels onto the sink vocabulary", () => {
    const levels: string[] = []
    const logger = pino(
      { hooks: { logMethod: createLogMethodHook((level) => levels.push(level)) } },
      new Writable({ write(_chunk, _enc, cb) { cb() } }),
    )

    logger.info("i")
    logger.warn("w")
    logger.error("e")

    expect(levels).toEqual(["info", "warn", "error"])
  })

  it("still writes the record to the destination", () => {
    const chunks: string[] = []
    const destination = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString())
        cb()
      },
    })
    const logger = pino(
      { hooks: { logMethod: createLogMethodHook(() => {}) } },
      destination,
    )

    logger.info({ msg: "written" })

    expect(chunks.join("")).toContain("written")
  })
})
