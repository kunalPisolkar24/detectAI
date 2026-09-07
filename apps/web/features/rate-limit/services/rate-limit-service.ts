import { usageRedis } from "@/lib/infrastructure/redis-limit"
import { metrics } from "@/lib/infrastructure/metrics"
import { logger } from "@/lib/infrastructure/logger"
import { analyticsPublisher } from "@/lib/infrastructure/analytics-publisher"
import { prisma } from "@/lib/infrastructure/prisma"

export interface IRateLimitService {
  checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }>
  trackUsage(userId: string, opts?: { eventId?: string; count?: number }): Promise<void>
  getRealTimeUsage(userId: string): Promise<{ dailyCount: number }>
}

/**
 * Rate-limit + usage accounting.
 *
 * Contract:
 * - Real-time enforcement lives in `usageRedis` (`REDIS_USAGE_URL`):
 *   key `rate_limit:{userId}:daily:YYYY-MM-DD` (UTC date), expiry at next UTC
 *   midnight. The worker never writes these keys.
 * - Authoritative billing lives in Postgres `Usage` (written asynchronously by
 *   `worker-analytics` via RabbitMQ `analytics.usage`).
 * - `trackUsage` writes BOTH independently. The DB fallback runs ONLY when
 *   both Redis and the queue fail — otherwise it would double-count
 *   (Redis + DB, or queue-flush + DB).
 */
export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100

  /** UTC calendar day, e.g. `2026-04-25`. All writers/readers must use UTC. */
  private getUTCDay(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10)
  }

  private getDailyKey(userId: string, now: Date = new Date()): string {
    return `rate_limit:{${userId}}:daily:${this.getUTCDay(now)}`
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
  private parseCounter(raw: string | null, userId: string, operation: string): number {
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
        const pipeline = usageRedis.pipeline()
        pipeline.incrby(dailyKey, count)
        pipeline.expireat(dailyKey, expireAt)
        const results = await pipeline.exec()
        // ioredis exec resolves to per-command [err, result] tuples (or null
        // when the offline queue is disabled). Any entry error = failure.
        if (!results) {
          throw new Error("Redis pipeline exec returned null (offline queue disabled)")
        }
        const failed = (results as Array<[Error | null, unknown]>).some(([err]) => err != null)
        if (failed) {
          throw new Error("Redis pipeline reported per-command error")
        }
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

    if (redisOk && !publishOk) {
      // Real-time enforcement is correct; the authoritative DB will lag until
      // the queue recovers. Do NOT direct-write the DB here — that would count
      // the event twice (Redis says counted, DB says counted, worker later
      // flushes a third time once RabbitMQ is back... actually twice total).
      logger.error({ msg: "Analytics publish failed after Redis increment; DB will lag until queue recovers", userId, eventId, error: publishError })
      return
    }

    if (!redisOk && publishOk) {
      // The worker will persist via the queue; a direct DB write would double
      // the count (queue flush + this upsert).
      logger.error({ msg: "Usage Redis unavailable, relying on queue flush for persistence", userId, eventId, error: redisError })
      return
    }

    // Both paths failed — best-effort direct DB increment so daily counts stay
    // consistent in postgres-only mode (the queue will be stale until recovery).
    logger.error({ msg: "Failed to track usage via Redis and queue, falling back to DB", userId, eventId, redisError, publishError })
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
