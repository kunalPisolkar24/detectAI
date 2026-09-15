import { redis } from "@/lib/infrastructure/redis"

export interface ICacheStorage {
  get(key: string): Promise<string | null>
  setex(key: string, ttl: number, value: string): Promise<void>
  del(...keys: string[]): Promise<void>
}

export class RedisCacheAdapter implements ICacheStorage {
  async get(key: string): Promise<string | null> {
    return redis.get(key)
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    await redis.setex(key, ttl, value)
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  }
}
