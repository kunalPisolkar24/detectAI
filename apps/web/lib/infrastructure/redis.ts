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
  redisWriter: Redis
  redisReader: Redis
}

const getRedisMode = () => env.REDIS_MODE ?? "sentinel"

const getStandaloneConfig = (): { url: string; options: RedisOptions } => {
  if (!env.REDIS_URL) {
    throw new Error("REDIS_URL is required when REDIS_MODE=standalone")
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

const getSentinelConfig = (): RedisOptions => {
  const sentinelStr = env.REDIS_SENTINELS || "localhost:26379,localhost:26380,localhost:26381"
  const sentinels = sentinelStr.split(",").map((s) => {
    const [host, port] = s.split(":")
    return { host: host || "localhost", port: parseInt(port || "26379", 10) }
  })

  return {
    sentinels,
    name: env.REDIS_MASTER_NAME || "mymaster",
    password: env.REDIS_PASSWORD,
    sentinelPassword: env.REDIS_PASSWORD,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 50, 500)),
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    family: 4,
    keepAlive: 10000,
    lazyConnect: true,
  }
}

const createRedisClients = () => {
  if (isPreviewMode()) {
    const preview = createPreviewRedis()
    return { writer: preview, reader: preview }
  }
  const mode = getRedisMode()
  const standaloneConfig = mode === "standalone" ? getStandaloneConfig() : null
  const writer =
    mode === "standalone"
      ? new Redis(standaloneConfig!.url, standaloneConfig!.options)
      : new Redis({
          ...getSentinelConfig(),
          role: "master",
        })

  const reader =
    mode === "standalone"
      ? new Redis(standaloneConfig!.url, standaloneConfig!.options)
      : new Redis({
          ...getSentinelConfig(),
          role: "slave",
        })

  writer.on("error", (err) => {
    console.error("Redis Writer Error:", err.message)
  })
  writer.on("close", () => {
    console.error("Redis Writer closed")
  })

  reader.on("error", (err) => {
    console.error("Redis Reader Error:", err.message)
  })
  reader.on("close", () => {
    console.error("Redis Reader closed")
  })

  return { writer, reader }
}

const clients = isPreviewMode()
  ? createRedisClients()
  : globalForRedis.redisWriter && globalForRedis.redisReader
    ? { writer: globalForRedis.redisWriter, reader: globalForRedis.redisReader }
    : createRedisClients()

export const redisWriter = clients.writer
export const redisReader = clients.reader

if (!isPreviewMode() && env.NODE_ENV !== "production") {
  globalForRedis.redisWriter = redisWriter
  globalForRedis.redisReader = redisReader
}
