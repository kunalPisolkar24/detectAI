/**
 * @deprecated — usage counters now live in `redis-cache` (`REDIS_URL`).
 *
 * The separate `REDIS_USAGE_URL` / cluster client is removed (3 Redis → 2:
 * `redis-cache` + `redis-events`). This module is kept as a thin alias so
 * existing imports/tests keep working:
 *
 * - `usageRedis` === `redisWriter` (master). Rate-limit reads/writes MUST go
 *   to the master — slave reads lag and would over-allow by 1-2.
 * - Daily keys: `rate_limit:{uid}:daily:YYYY-MM-DD` (legacy `{uid}` braces
 *   kept for rolling-deploy compat).
 * - `analytics:usage:event:{id}` dedup also lives in `redis-cache`.
 * - `redis-events` is Paddle-only (`paddle:evt:*`, `payment:event:ts:*`).
 */
import type Redis from "ioredis"
import { redisWriter } from "@/lib/infrastructure/redis"

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

const createPreviewUsageRedis = () =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined
        if (prop === "pipeline") {
          return () => ({
            incr: function () { return this },
            incrby: function () { return this },
            expire: function () { return this },
            expireat: function () { return this },
            exec: async () => [],
          })
        }
        if (prop === "eval") {
          return async () => 1
        }
        return async () => null
      },
    },
  ) as unknown as Redis

// Singleton alias — never a second connection.
export const usageRedis: Redis = (isPreviewMode()
  ? createPreviewUsageRedis()
  : redisWriter) as Redis
