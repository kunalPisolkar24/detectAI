import { redis } from "@/lib/infrastructure/redis"
import { metrics } from "@/lib/infrastructure/metrics"
import { logger } from "@/lib/infrastructure/logger"
import { analyticsPublisher } from "@/lib/infrastructure/analytics-publisher"
import { prisma } from "@/lib/infrastructure/prisma"
import { CacheKeys } from "@/lib/services/cache-keys"
import { isPreviewMode } from "@/lib/config/preview"

const previewRedis = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined
      if (prop === "eval") return async () => 1
      return async () => null
    },
  },
) as unknown as typeof redis

const usageRedis = isPreviewMode() ? previewRedis : redis

export interface IRateLimitService {
  checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }>
  trackUsage(userId: string, opts?: { eventId?: string; count?: number }): Promise<void>
  getRealTimeUsage(userId: string): Promise<{ dailyCount: number }>
}

// Rate-limit + usage. Redis (REDIS_URL) for real-time, Postgres for billing via RabbitMQ.
export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100

  private static readonly INCR_EXPIRE_LUA = `
    local current = redis.call('INCRBY', KEYS[1], ARGV[1])
    redis.call('EXPIREAT', KEYS[1], ARGV[2])
    return current
  `

  private getUTCDay(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10)
  }

  private getDailyKey(userId: string, now: Date = new Date()): string {
    return CacheKeys.dailyUsage(userId, this.getUTCDay(now))
  }

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

  public async checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
    if (isPremium) {
      return { allowed: true, remaining: -1 }
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
    const eventId = opts?.eventId ?? crypto.randomUUID()

    const now = new Date()
    const dailyKey = this.getDailyKey(userId, now)
    const expireAt = this.getNextMidnightUTCSeconds(now)

    let redisOk = false
    let redisError: unknown = null
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
      logger.error({ msg: "Usage Redis unavailable, relying on queue flush for persistence", userId, eventId, error: redisError })
      return
    }

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
    }
  }

  public async getRealTimeUsage(userId: string): Promise<{ dailyCount: number }> {
    try {
      const daily = await usageRedis.get(this.getDailyKey(userId))
      if (daily !== null) {
        return { dailyCount: this.parseCounter(daily, userId, "get") }
      }
    } catch (error) {
      try { metrics.usageRedisErrors.inc({ operation: "get" }) } catch {}
      logger.error({ msg: "Redis read failed, falling back to DB", userId, error })
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
