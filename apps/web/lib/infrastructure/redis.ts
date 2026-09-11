import Redis, { RedisOptions } from "ioredis"
import { env } from "@/lib/config/env"

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

const createPreviewRedis = () =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined
        // Return no-op async functions for any Redis method in preview
        return async () => null
      },
    },
  ) as unknown as Redis

const globalForRedis = global as unknown as {
  redis: Redis
}

const getStandaloneConfig = (): { url: string; options: RedisOptions } => {
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is required")
  }

  return {
    url: env.REDIS_URL,
    options: {
      password: env.REDIS_PASSWORD,
      // Fail fast so cache/lock callers degrade to postgres-only mode quickly
      // instead of hanging on retries (lock-service/readyz already have their own 2s timeouts,
      // but maxRetriesPerRequest:null would queue forever offline).
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 50, 500)),
      enableReadyCheck: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      family: 4,
      keepAlive: 10000,
      lazyConnect: true,
    },
  }
}

const createRedisClient = (): Redis => {
  if (isPreviewMode()) {
    return createPreviewRedis()
  }
  const { url, options } = getStandaloneConfig()
  const client = new Redis(url, options)

  client.on("error", (err) => {
    console.error("Redis Error:", err.message)
  })
  client.on("close", () => {
    console.error("Redis closed")
  })

  return client
}

const client = isPreviewMode()
  ? createRedisClient()
  : globalForRedis.redis ?? createRedisClient()

export const redis = client
// Back-compat aliases for incremental migration — all point to the same standalone client
export const redisWriter = redis
export const redisReader = redis

if (!isPreviewMode() && env.NODE_ENV !== "production") {
  globalForRedis.redis = redis
}
