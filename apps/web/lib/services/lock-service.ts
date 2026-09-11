import { redis } from "@/lib/infrastructure/redis"
import { logger } from "@/lib/infrastructure/logger"

const RETRY_COUNT = 10
const RETRY_DELAY_MS = 200
const RETRY_JITTER_MS = 200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const lockService = {
  async execute<T>(resource: string, task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    const lockKey = `lock:${resource}`
    const lockValue = crypto.randomUUID()

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      let acquired: string | null = null
      try {
        acquired = await redis.set(lockKey, lockValue, "PX", ttlMs, "NX")
      } catch (error) {
        // Redis unavailable — degrade to postgres-only mode: run without lock.
        logger.warn({ msg: "Lock store unavailable, running without lock", resource, error })
        return await task()
      }

      if (acquired) {
        try {
          return await task()
        } finally {
          try {
            await redis.eval(
              `if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("DEL", KEYS[1]) end`,
              1,
              lockKey,
              lockValue
            )
          } catch (error) {
            logger.warn({ msg: "Failed to release lock", resource, error })
          }
        }
      }

      if (attempt < RETRY_COUNT) {
        const jitter = Math.floor(Math.random() * RETRY_JITTER_MS)
        await sleep(RETRY_DELAY_MS + jitter)
      }
    }

    // Contended without Redis error — also degrade rather than throw, so a
    // transient lock race does not fail the request when Redis is usable but busy.
    logger.warn({ msg: "Could not acquire lock, running without lock", resource })
    return await task()
  },

  async executeMulti<T>(keys: string[], task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    const compositeKey = JSON.stringify([...keys].sort())
    return this.execute(compositeKey, task, ttlMs)
  },
}
