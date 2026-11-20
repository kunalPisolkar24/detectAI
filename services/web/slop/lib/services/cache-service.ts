import { JsonSerializer } from "@/lib/core/serialization"
import { metrics } from "@/lib/infrastructure/metrics"
import { logger } from "@/lib/infrastructure/logger"
import { type ICacheStorage, RedisCacheAdapter } from "@/lib/infrastructure/redis-cache-adapter"

import { CacheKeys, CacheTTL } from "@/lib/services/cache-keys"

export const TTL = {
  USER_BASIC: CacheTTL.USER_BASIC,
  USER_SUB: CacheTTL.USER_SUB,
}

export class CacheService {
  constructor(private storage: ICacheStorage) {}

  public keys = {
    userBasic: (id: string) => CacheKeys.userBasic(id),
    userBasicByEmail: (email: string) => CacheKeys.userBasicByEmail(email),
    userSub: (id: string) => CacheKeys.userSub(id),
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.storage.get(key)
      
      if (!data) {
        metrics.cacheOperations.inc({ operation: 'get', status: 'miss' })
        return null
      }
      
      metrics.cacheOperations.inc({ operation: 'get', status: 'hit' })
      return JsonSerializer.deserialize<T>(data)
    } catch (error) {
      metrics.cacheOperations.inc({ operation: 'get', status: 'error' })
      logger.error({ msg: "Cache Read Error", key, error })
      return null
    }
  }

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    try {
      const serialized = JsonSerializer.serialize(data)
      await this.storage.setex(key, ttl, serialized)
      metrics.cacheOperations.inc({ operation: 'set', status: 'success' })
    } catch (error) {
      metrics.cacheOperations.inc({ operation: 'set', status: 'error' })
      logger.error({ msg: "Cache Write Error", key, error })
    }
  }

  async del(keys: string | string[]): Promise<void> {
    try {
      const targetKeys = Array.isArray(keys) ? keys : [keys]
      await this.storage.del(...targetKeys)
      metrics.cacheOperations.inc({ operation: 'del', status: 'success' })
    } catch (error) {
      metrics.cacheOperations.inc({ operation: 'del', status: 'error' })
      logger.error({ msg: "Cache Delete Error", error })
    }
  }
}

export const cacheService = new CacheService(new RedisCacheAdapter())
