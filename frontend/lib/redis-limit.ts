import Redis from "ioredis"
import { env } from "@/lib/env"

const globalForRedis = global as unknown as { usageRedis: Redis }

export const usageRedis =
    globalForRedis.usageRedis ||
    new Redis(env.REDIS_USAGE_URL)

if (env.NODE_ENV !== "production") globalForRedis.usageRedis = usageRedis
