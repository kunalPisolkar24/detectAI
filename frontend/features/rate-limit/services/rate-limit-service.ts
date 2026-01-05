import { usageRedis } from "@/lib/redis-limit"
import { startOfDay, format } from "date-fns"

export interface IRateLimitService {
    checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }>
    trackUsage(userId: string): Promise<void>
    getRealTimeUsage(userId: string): Promise<{ dailyCount: number; pendingCount: number }>
}

export class RedisRateLimitService implements IRateLimitService {
    private static readonly FREE_TIER_LIMIT = 100
    private static readonly USAGE_TTL = 86400 * 7 // 7 days retention for safety
    private static readonly RATE_LIMIT_TTL = 86400 // 24 hours

    private getDailyKey(userId: string): string {
        const today = format(startOfDay(new Date()), "yyyy-MM-dd")
        return `rate_limit:daily:${today}:${userId}`
    }

    private getPendingKey(userId: string): string {
        return `usage:pending:${userId}`
    }

    private getDirtySetKey(): string {
        return "usage:dirty_users"
    }

    public async checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
        if (isPremium) {
            return { allowed: true, remaining: Infinity }
        }

        const key = this.getDailyKey(userId)
        const usage = await usageRedis.get(key)
        const currentUsage = usage ? parseInt(usage, 10) : 0

        return {
            allowed: currentUsage < RedisRateLimitService.FREE_TIER_LIMIT,
            remaining: Math.max(0, RedisRateLimitService.FREE_TIER_LIMIT - currentUsage),
        }
    }

    public async trackUsage(userId: string): Promise<void> {
        const dailyKey = this.getDailyKey(userId)
        const pendingKey = this.getPendingKey(userId)
        const dirtySetKey = this.getDirtySetKey()

        const pipeline = usageRedis.pipeline()

        pipeline.incr(dailyKey)
        pipeline.expire(dailyKey, RedisRateLimitService.RATE_LIMIT_TTL)

        pipeline.incr(pendingKey)
        pipeline.expire(pendingKey, RedisRateLimitService.USAGE_TTL)

        pipeline.sadd(dirtySetKey, userId)

        await pipeline.exec()
    }

    public async getRealTimeUsage(userId: string): Promise<{ dailyCount: number; pendingCount: number }> {
        const dailyKey = this.getDailyKey(userId)
        const pendingKey = this.getPendingKey(userId)

        const [daily, pending] = await Promise.all([
            usageRedis.get(dailyKey),
            usageRedis.get(pendingKey)
        ])

        return {
            dailyCount: daily ? parseInt(daily, 10) : 0,
            pendingCount: pending ? parseInt(pending, 10) : 0
        }
    }
}

export const rateLimitService = new RedisRateLimitService()
