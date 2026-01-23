import Redlock, { ExecutionError } from "redlock"
import { redisWriter } from "@/lib/redis"

const redlock = new Redlock(
  [redisWriter],
  {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500,
  }
)

redlock.on("error", (error) => {
  if (error instanceof ExecutionError) {
    return
  }
  console.error("Redlock Error:", error)
})

export const lockService = {
  async acquire(key: string, ttl: number = 5000): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`

    try {
      const lock = await redlock.acquire([lockKey], ttl)

      return async () => {
        try {
          await lock.release()
        } catch (error) {
          if (process.env.NODE_ENV === "development") {
            console.warn(`Failed to release lock ${key}`, error)
          }
        }
      }
    } catch {
      return null
    }
  }
}