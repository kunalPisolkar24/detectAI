import { usageRedis } from "@/lib/redis-limit"
import { startOfDay, format } from "date-fns"
import { metrics } from "@/lib/metrics"
import { logger } from "@/lib/logger"

export interface IRateLimitService {
  checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }>
  trackUsage(userId: string): Promise<void>
  getRealTimeUsage(userId: string): Promise<{ dailyCount: number; pendingCount: number }>
}

export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100
  private static readonly PENDING_TTL = 86400
  private static readonly RATE_LIMIT_TTL = 86400
  private static readonly GLOBAL_DIRTY_SET_KEY = "usage:dirty_users"

  private getDailyKey(userId: string): string {
    const today = format(startOfDay(new Date()), "yyyy-MM-dd")
    return `rate_limit:{${userId}}:daily:${today}`
  }

  private getPendingKey(userId: string): string {
    return `usage:{${userId}}:pending`
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
      logger.error({ msg: "Rate limit check failed", userId, error })
      return { allowed: true, remaining: 1 }
    }
  }

  public async trackUsage(userId: string): Promise<void> {
    const dailyKey = this.getDailyKey(userId)
    const pendingKey = this.getPendingKey(userId)

    const userPipeline = usageRedis.pipeline()

    userPipeline.incr(dailyKey)
    userPipeline.expire(dailyKey, RedisRateLimitService.RATE_LIMIT_TTL)
    
    userPipeline.incr(pendingKey)
    userPipeline.expire(pendingKey, RedisRateLimitService.PENDING_TTL)

    try {
      await Promise.all([
        userPipeline.exec(),
        usageRedis.sadd(RedisRateLimitService.GLOBAL_DIRTY_SET_KEY, userId)
      ])
    } catch (error) {
      logger.error({ msg: "Failed to track usage metrics", userId, error })
    }
  }

  public async getRealTimeUsage(userId: string): Promise<{ dailyCount: number; pendingCount: number }> {
    const dailyKey = this.getDailyKey(userId)
    const pendingKey = this.getPendingKey(userId)

    try {
      const [daily, pending] = await Promise.all([
        usageRedis.get(dailyKey),
        usageRedis.get(pendingKey)
      ])

      return {
        dailyCount: daily ? parseInt(daily, 10) : 0,
        pendingCount: pending ? parseInt(pending, 10) : 0
      }
    } catch (error) {
      logger.error({ msg: "Failed to retrieve real-time usage", userId, error })
      return { dailyCount: 0, pendingCount: 0 }
    }
  }
}

export const rateLimitService = new RedisRateLimitService()