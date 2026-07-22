import { redisWriter } from "@/lib/infrastructure/redis"

export const lockService = {
  async execute<T>(resource: string, task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    const lockKey = `lock:${resource}`
    const lockValue = crypto.randomUUID()

    const acquired = await redisWriter.set(lockKey, lockValue, "PX", ttlMs, "NX")
    if (!acquired) throw new Error("Could not acquire lock")

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
  },

  async executeMulti<T>(keys: string[], task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    return this.execute(keys[0], task, ttlMs)
  },
}
