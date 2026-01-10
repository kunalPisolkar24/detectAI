import { redisReader, redisWriter } from "@/lib/redis"
import { JsonSerializer } from "@/lib/serialization"

export const TTL = {
  USER: 3600,
}

export const cacheService = {
  keys: {
    user: (id: string) => `user:id:${id}`,
    userByEmail: (email: string) => `user:email:${email}`,
  },

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redisReader.get(key)
      if (!data) return null
      return JsonSerializer.deserialize<T>(data)
    } catch (error) {
      console.error(`Cache Read Error [${key}]:`, error)
      return null
    }
  },

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    try {
      const serialized = JsonSerializer.serialize(data)
      await redisWriter.setex(key, ttl, serialized)
    } catch (error) {
      console.error(`Cache Write Error [${key}]:`, error)
    }
  },

  async del(keys: string | string[]): Promise<void> {
    try {
      const targetKeys = Array.isArray(keys) ? keys : [keys]
      if (targetKeys.length > 0) {
        await redisWriter.del(...targetKeys)
      }
    } catch (error) {
      console.error(`Cache Delete Error:`, error)
    }
  }
}