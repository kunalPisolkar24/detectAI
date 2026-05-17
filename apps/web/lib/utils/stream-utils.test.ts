import { describe, it, expect } from "vitest"
import { createNDJSONStream } from "./stream-utils"

describe("createNDJSONStream", () => {
  it("formats enqueued objects as NDJSON", async () => {
    const stream = createNDJSONStream(async (enqueue) => {
      enqueue({ data: "foo" })
      enqueue({ data: "bar" })
    })
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value)
    }
    expect(result).toBe('{"data":"foo"}\n{"data":"bar"}\n')
  })

  it("handles executor errors", async () => {
    const stream = createNDJSONStream(async () => {
      throw new Error("fail")
    })
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value)
    }
    expect(result).toContain('"type":"error"')
    expect(result).toContain('"error":"fail"')
  })

  it("swallows enqueue errors when controller is closed", async () => {
    let capturedEnqueue: any
    const stream = createNDJSONStream(async (enqueue) => {
      capturedEnqueue = enqueue
    })
    const reader = stream.getReader()
    await reader.cancel()
    expect(() => capturedEnqueue({ foo: "bar" })).not.toThrow()
  })
})
