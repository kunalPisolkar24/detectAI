import { redisWriter } from "@/lib/infrastructure/redis"

const RETRY_COUNT = 10
const RETRY_DELAY_MS = 200
const RETRY_JITTER_MS = 200

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const lockService = {
  async execute<T>(resource: string, task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    const lockKey = `lock:${resource}`
    const lockValue = crypto.randomUUID()

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      const acquired = await redisWriter.set(lockKey, lockValue, "PX", ttlMs, "NX")
      if (acquired) {
        try {
          return await task()
        } finally {
          await redisWriter.eval(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("DEL", KEYS[1]) end`,
            1,
            lockKey,
            lockValue
          )
        }
      }

      if (attempt < RETRY_COUNT) {
        const jitter = Math.floor(Math.random() * RETRY_JITTER_MS)
        await sleep(RETRY_DELAY_MS + jitter)
      }
    }

    throw new Error("Could not acquire lock")
  },

  async executeMulti<T>(keys: string[], task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    const compositeKey = JSON.stringify([...keys].sort())
    return this.execute(compositeKey, task, ttlMs)
  },
}
