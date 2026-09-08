import { usageRedis } from "@/lib/infrastructure/redis-limit"
import { metrics } from "@/lib/infrastructure/metrics"
import { logger } from "@/lib/infrastructure/logger"
import { analyticsPublisher } from "@/lib/infrastructure/analytics-publisher"
import { prisma } from "@/lib/infrastructure/prisma"
import { CacheKeys } from "@/lib/services/cache-keys"

export interface IRateLimitService {
  checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }>
  trackUsage(userId: string, opts?: { eventId?: string; count?: number }): Promise<void>
  getRealTimeUsage(userId: string): Promise<{ dailyCount: number }>
}

/**
 * Rate-limit + usage accounting (2-Redis world).
 *
 * - Real-time enforcement lives in `redis-cache` (`REDIS_URL`):
 *   key `rate_limit:{userId}:daily:YYYY-MM-DD` (UTC date), expiry at next UTC
 *   midnight. Atomic Lua `INCRBY+EXPIREAT` (no leak on crash between cmds).
 *   Reads AND writes go to the master (`usageRedis` === `redisWriter`) —
 *   slave reads would lag and over-allow.
 * - Authoritative billing lives in Postgres `Usage` (written asynchronously by
 *   `worker-analytics` via RabbitMQ `analytics.usage`, or synchronously by
 *   the fallback below when the queue is down).
 * - `analytics:usage:event:{id}` dedup lives in `redis-cache`. `redis-events`
 *   is Paddle-only.
 * - Cached user rows (`user:basic:*`, `user:sub:*`) exclude usage counters,
 *   so usage tracking NEVER invalidates user cache.
 *
 * `trackUsage` truth table (no double-count — fallback never publishes):
 * - redisOk && publishOk    → return (worker will UPSERT via queue)
 * - !redisOk && publishOk   → return, log (worker will UPSERT; Redis undercounts)
 * - redisOk && !publishOk   → Redis INCR kept + sync DB UPSERT (queue lost it)
 * - !redisOk && !publishOk  → sync DB UPSERT (postgres-only mode)
 */
export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100

  /**
   * Atomic increment + expiry. A two-command pipeline can leak a persistent
   * key if the process crashes between INCRBY and EXPIREAT (next-day
   * overcount) — Lua keeps it atomic.
   */
  private static readonly INCR_EXPIRE_LUA = `
    local current = redis.call('INCRBY', KEYS[1], ARGV[1])
    redis.call('EXPIREAT', KEYS[1], ARGV[2])
    return current
  `

  /** UTC calendar day, e.g. `2026-04-25`. All writers/readers must use UTC. */
  private getUTCDay(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10)
  }

  private getDailyKey(userId: string, now: Date = new Date()): string {
    return CacheKeys.dailyUsage(userId, this.getUTCDay(now))
  }

  /** Unix seconds of next UTC midnight — keys expire at the day boundary, not sliding 24h. */
  private getNextMidnightUTCSeconds(now: Date = new Date()): number {
    const y = now.getUTCFullYear()
    const m = now.getUTCMonth()
    const d = now.getUTCDate()
    return Math.floor(Date.UTC(y, m, d + 1, 0, 0, 0, 0) / 1000)
  }

  private isSameUTCDay(a: Date | null | undefined, b: Date): boolean {
    if (!a) return false
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
  }

  /** Parse a Redis counter defensively: corrupt values degrade to 0 + metric, never NaN. */
  private parseCounter(raw: string | null, userId: string, _operation: string): number {
    if (raw === null) return 0
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0) {
      logger.warn({ msg: "Corrupt usage counter in Redis, treating as 0", userId, raw })
      try { metrics.usageRedisErrors.inc({ operation: "corrupt_value" }) } catch {}
      return 0
    }
    return n
  }

  /** cuid() ids are safe; guard the `{userId}` hash-tag against pathological ids. */
  private isRedisSafeUserId(userId: string): boolean {
    return typeof userId === "string" && userId.length > 0 && !userId.includes("{") && !userId.includes("}")
  }

  public async checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
    if (isPremium) {
      return { allowed: true, remaining: -1 }
    }

    if (!this.isRedisSafeUserId(userId)) {
      logger.warn({ msg: "Unsafe userId for Redis hash-tag, using DB fallback", userId })
      return this.checkLimitFromDB(userId)
    }

    try {
      const key = this.getDailyKey(userId)
      const usage = await usageRedis.get(key)
      const currentUsage = this.parseCounter(usage, userId, "get")
      const allowed = currentUsage < RedisRateLimitService.FREE_TIER_LIMIT

      if (!allowed) {
        metrics.rateLimitHits.inc({ tier: 'free' })
      }

      return {
        allowed,
        remaining: Math.max(0, RedisRateLimitService.FREE_TIER_LIMIT - currentUsage),
      }
    } catch (error) {
      try { metrics.usageRedisErrors.inc({ operation: "get" }) } catch {}
      logger.error({ msg: "Rate limit check failed, falling back to DB", userId, error })
      return this.checkLimitFromDB(userId)
    }
  }

  private async checkLimitFromDB(userId: string): Promise<{ allowed: boolean; remaining: number }> {
    try {
      const now = new Date()
      const usage = await prisma.usage.findUnique({ where: { userId } })
      // DB daily is reset by the worker/cron on UTC day rollover; a stale
      // `lastApiCallReset` from a previous day means today's count is 0.
      const sameDay = this.isSameUTCDay(usage?.lastApiCallReset ?? null, now)
      const currentUsage = sameDay ? (usage?.apiCallCountDaily ?? 0) : 0
      const allowed = currentUsage < RedisRateLimitService.FREE_TIER_LIMIT

      if (!allowed) {
        metrics.rateLimitHits.inc({ tier: 'free' })
      }

      return {
        allowed,
        remaining: Math.max(0, RedisRateLimitService.FREE_TIER_LIMIT - currentUsage),
      }
    } catch (dbError) {
      logger.error({ msg: "DB fallback failed for rate limit check", userId, error: dbError })
      return { allowed: true, remaining: 1 }
    }
  }

  public async trackUsage(userId: string, opts?: { eventId?: string; count?: number }): Promise<void> {
    const count = opts?.count ?? 1
    if (!Number.isInteger(count) || count <= 0) {
      logger.error({ msg: "trackUsage called with invalid count, skipping", userId, count })
      return
    }
    // One idempotency key per logical event — generated once here and reused
    // for the queue message so redeliveries dedupe in the worker.
    const eventId = opts?.eventId ?? crypto.randomUUID()

    const now = new Date()
    const dailyKey = this.getDailyKey(userId, now)
    const expireAt = this.getNextMidnightUTCSeconds(now)

    let redisOk = false
    let redisError: unknown = null
    if (!this.isRedisSafeUserId(userId)) {
      redisError = new Error("unsafe userId for Redis hash-tag")
    } else {
      try {
        await (usageRedis as unknown as {
          eval: (script: string, numKeys: number, key: string, count: string, expireAt: string) => Promise<unknown>
        }).eval(
          RedisRateLimitService.INCR_EXPIRE_LUA,
          1,
          dailyKey,
          String(count),
          String(expireAt),
        )
        redisOk = true
      } catch (error) {
        redisError = error
        try { metrics.usageRedisErrors.inc({ operation: "incr" }) } catch {}
      }
    }

    let publishOk = false
    let publishError: unknown = null
    try {
      await analyticsPublisher.publish(userId, count, eventId)
      publishOk = true
    } catch (error) {
      publishError = error
    }

    if (redisOk && publishOk) return

    if (!redisOk && publishOk) {
      // The worker will persist via the queue; a direct DB write would double
      // the count (queue flush + this upsert). Redis undercounts until the
      // next event re-creates the key — accepted, worker/DB stay exact.
      logger.error({ msg: "Usage Redis unavailable, relying on queue flush for persistence", userId, eventId, error: redisError })
      return
    }

    // RabbitMQ is down (with or without Redis): the queue never got this
    // eventId, so a sync DB UPSERT cannot double-count. This keeps billing
    // exact instead of letting the DB lag until the broker recovers.
    // No user-cache invalidation: cached rows exclude usage counters.
    const reason = !redisOk ? "redis_and_queue_down" : "queue_down"
    try { metrics.usageSyncFallback.inc({ reason }) } catch {}
    logger.error({ msg: "Analytics publish failed, falling back to sync DB write", userId, eventId, reason, redisError, publishError })
    try {
      await prisma.$executeRaw`
        INSERT INTO "Usage" ("id", "userId", "apiCallCountTotal", "apiCallCountDaily", "lastApiCallReset", "updatedAt", "createdAt")
        VALUES (gen_random_uuid(), ${userId}, ${count}, ${count}, NOW(), NOW(), NOW())
        ON CONFLICT ("userId") DO UPDATE SET
          "apiCallCountTotal" = "Usage"."apiCallCountTotal" + EXCLUDED."apiCallCountTotal",
          "apiCallCountDaily" = CASE
            WHEN ("Usage"."lastApiCallReset" IS NULL OR ("Usage"."lastApiCallReset" AT TIME ZONE 'UTC')::date < (NOW() AT TIME ZONE 'UTC')::date)
            THEN EXCLUDED."apiCallCountDaily"
            ELSE "Usage"."apiCallCountDaily" + EXCLUDED."apiCallCountDaily"
          END,
          "lastApiCallReset" = NOW(),
          "updatedAt" = NOW()
      `
    } catch (dbError) {
      logger.error({ msg: "DB fallback failed for trackUsage", userId, eventId, error: dbError })
      // Partial-failure note: if Redis INCR succeeded but this UPSERT failed,
      // Redis overcounts by `count` while the DB undercounts. The next
      // successful event self-heals the DB; Redis self-heals at midnight
      // expiry. Alert on `usage_redis_errors_total` + this log, do NOT
      // retry-publish the same eventId (would double-count on recovery).
    }
  }

  public async getRealTimeUsage(userId: string): Promise<{ dailyCount: number }> {
    if (this.isRedisSafeUserId(userId)) {
      try {
        const daily = await usageRedis.get(this.getDailyKey(userId))
        if (daily !== null) {
          return { dailyCount: this.parseCounter(daily, userId, "get") }
        }
      } catch (error) {
        try { metrics.usageRedisErrors.inc({ operation: "get" }) } catch {}
        logger.error({ msg: "Redis read failed, falling back to DB", userId, error })
      }
    }

    try {
      const now = new Date()
      const usage = await prisma.usage.findUnique({ where: { userId } })
      if (!this.isSameUTCDay(usage?.lastApiCallReset ?? null, now)) {
        return { dailyCount: 0 }
      }
      return { dailyCount: usage?.apiCallCountDaily ?? 0 }
    } catch (error) {
      logger.error({ msg: "DB fallback failed for real-time usage", userId, error })
      return { dailyCount: 0 }
    }
  }
}

export const rateLimitService = new RedisRateLimitService()
