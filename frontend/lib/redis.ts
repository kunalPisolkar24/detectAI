import Redis from "ioredis"
import { env } from "@/lib/env"

const globalForRedis = global as unknown as { redis: Redis }

const createRedisClient = () => {
  const client = new Redis(env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null, 
    enableReadyCheck: false
  })

  client.on('error', (err) => {
    console.error("Redis Client Error:", err) 
  })

  return client
}

export const redis = globalForRedis.redis || createRedisClient()

if (env.NODE_ENV !== "production") globalForRedis.redis = redis