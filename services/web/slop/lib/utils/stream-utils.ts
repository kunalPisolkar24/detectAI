export function createNDJSONStream(
  executor: (enqueue: (data: unknown) => void) => Promise<void>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const enqueue = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"))
        } catch {
        }
      }

      try {
        await executor(enqueue)
      } catch (error) {
        enqueue({
          type: "error",
          error: error instanceof Error ? error.message : "Internal Stream Error"
        })
      } finally {
        try {
          controller.close()
        } catch {
        }
      }
    }
  })
}
