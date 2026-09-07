import { usageRedis } from "@/lib/infrastructure/redis-limit"
import { startOfDay, format } from "date-fns"
import { metrics } from "@/lib/infrastructure/metrics"
import { logger } from "@/lib/infrastructure/logger"
import { analyticsPublisher } from "@/lib/infrastructure/analytics-publisher"
import { prisma } from "@/lib/infrastructure/prisma"

export interface IRateLimitService {
  checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }>
  trackUsage(userId: string): Promise<void>
  getRealTimeUsage(userId: string): Promise<{ dailyCount: number }>
}

export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100
  private static readonly RATE_LIMIT_TTL = 86400

  private getDailyKey(userId: string): string {
    const today = format(startOfDay(new Date()), "yyyy-MM-dd")
    return `rate_limit:{${userId}}:daily:${today}`
  }

  public async checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
    if (isPremium) {
      return { allowed: true, remaining: -1 }
    }

    try {
      const key = this.getDailyKey(userId)
      const usage = await usageRedis.get(key)
      const currentUsage = usage ? parseInt(usage, 10) : 0
      const allowed = currentUsage < RedisRateLimitService.FREE_TIER_LIMIT

      if (!allowed) {
        metrics.rateLimitHits.inc({ tier: 'free' })
      }

      return {
        allowed,
        remaining: Math.max(0, RedisRateLimitService.FREE_TIER_LIMIT - currentUsage),
      }
    } catch (error) {
      logger.error({ msg: "Rate limit check failed, falling back to DB", userId, error })

      try {
        const usage = await prisma.usage.findUnique({ where: { userId } })
        const currentUsage = usage?.apiCallCountDaily ?? 0
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
  }

  public async trackUsage(userId: string): Promise<void> {
    const dailyKey = this.getDailyKey(userId)
    const userPipeline = usageRedis.pipeline()
    userPipeline.incr(dailyKey)
    userPipeline.expire(dailyKey, RedisRateLimitService.RATE_LIMIT_TTL)

    try {
      await Promise.all([
        userPipeline.exec(),
        analyticsPublisher.publish(userId, 1),
      ])
      return
    } catch (error) {
      logger.error({ msg: "Failed to track usage metrics, falling back to DB", userId, error })
    }

    // Redis unavailable — best-effort direct DB increment so daily counts
    // stay consistent in postgres-only mode (the queue will be stale).
    try {
      const now = new Date()
      const start = startOfDay(now)
      await prisma.usage.upsert({
        where: { userId },
        create: { userId, apiCallCountDaily: 1, apiCallCountTotal: 1, lastApiCallReset: start },
        update: { apiCallCountDaily: { increment: 1 }, apiCallCountTotal: { increment: 1 } },
      })
    } catch (dbError) {
      logger.error({ msg: "DB fallback failed for trackUsage", userId, error: dbError })
    }
  }

  public async getRealTimeUsage(userId: string): Promise<{ dailyCount: number }> {
    try {
      const daily = await usageRedis.get(this.getDailyKey(userId))
      if (daily !== null) {
        return { dailyCount: parseInt(daily, 10) }
      }
    } catch (error) {
      logger.error({ msg: "Redis read failed, falling back to DB", userId, error })
    }

    try {
      const usage = await prisma.usage.findUnique({ where: { userId } })
      return { dailyCount: usage?.apiCallCountDaily ?? 0 }
    } catch (error) {
      logger.error({ msg: "DB fallback failed for real-time usage", userId, error })
      return { dailyCount: 0 }
    }
  }
}

export const rateLimitService = new RedisRateLimitService()
