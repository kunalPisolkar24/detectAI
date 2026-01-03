import Redis from "ioredis"
import { env } from "@/lib/env"

const globalForRedis = global as unknown as { redis: Redis }

export const redis =
  globalForRedis.redis ||
  new Redis(env.REDIS_URL || "redis://localhost:6379")

if (env.NODE_ENV !== "production") globalForRedis.redis = redis