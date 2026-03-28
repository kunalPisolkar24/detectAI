import Redis, { RedisOptions } from "ioredis"
import { env } from "@/lib/env"

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
      retryStrategy: (times) => Math.min(times * 50, 2000),
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      family: 4,
      keepAlive: 10000,
      lazyConnect: true,
    },
  }
}

const getSentinelConfig = (): RedisOptions => {
  const sentinelStr = env.REDIS_SENTINELS || "localhost:26379"
  const sentinels = sentinelStr.split(",").map((s) => {
    const [host, port] = s.split(":")
    return { host, port: parseInt(port, 10) }
  })

  return {
    sentinels,
    name: env.REDIS_MASTER_NAME,
    password: env.REDIS_PASSWORD,
    sentinelPassword: env.REDIS_PASSWORD,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
    family: 4,
    keepAlive: 10000,
    lazyConnect: true,
  }
}

const createRedisClients = () => {
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

  reader.on("error", (err) => {
    console.error("Redis Reader Error:", err.message)
  })

  return { writer, reader }
}

const clients = globalForRedis.redisWriter && globalForRedis.redisReader
  ? { writer: globalForRedis.redisWriter, reader: globalForRedis.redisReader }
  : createRedisClients()

export const redisWriter = clients.writer
export const redisReader = clients.reader

if (env.NODE_ENV !== "production") {
  globalForRedis.redisWriter = redisWriter
  globalForRedis.redisReader = redisReader
}
