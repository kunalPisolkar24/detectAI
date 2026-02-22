import Redis, { RedisOptions } from "ioredis"
import { env } from "@/lib/env"

const globalForRedis = global as unknown as {
  redisWriter: Redis
  redisReader: Redis
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
  const options = getSentinelConfig()

  const writer = new Redis({
    ...options,
    role: "master",
  })

  const reader = new Redis({
    ...options,
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