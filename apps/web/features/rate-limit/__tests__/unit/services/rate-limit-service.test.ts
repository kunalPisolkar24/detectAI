import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RedisRateLimitService } from '../../../services/rate-limit-service'
import { metrics } from '@/lib/infrastructure/metrics'
import { logger } from '@/lib/infrastructure/logger'
import { analyticsPublisher } from '@/lib/infrastructure/analytics-publisher'
import { prisma } from '@/lib/infrastructure/prisma'
import { redisWriter } from '@/lib/infrastructure/redis'

vi.mock('@/lib/infrastructure/redis', () => ({
  redisWriter: {
    get: vi.fn(),
    eval: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
  },
  redisReader: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/infrastructure/analytics-publisher', () => ({
  analyticsPublisher: {
    publish: vi.fn(),
  },
}))

vi.mock('@/lib/infrastructure/prisma', () => ({
  prisma: {
    usage: {
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}))

describe('RedisRateLimitService', () => {
  let service: RedisRateLimitService

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'))
    service = new RedisRateLimitService()
    vi.mocked(redisWriter.eval as any).mockResolvedValue(1)
    vi.mocked(analyticsPublisher.publish).mockResolvedValue('evt-123' as any)
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates correct UTC daily key based on current date', async () => {
    vi.mocked(redisWriter.get).mockResolvedValue('0')
    await service.checkLimit('user-1', false)
    expect(redisWriter.get).toHaveBeenCalledWith('rate_limit:{user-1}:daily:2026-04-25')
  })

  describe('checkLimit', () => {
    it('allows premium users immediately without calling redis', async () => {
      const result = await service.checkLimit('user-premium', true)
      expect(result).toEqual({ allowed: true, remaining: -1 })
      expect(redisWriter.get).not.toHaveBeenCalled()
    })

    it('allows free users under the limit', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue('99')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: true, remaining: 1 })
    })

    it('blocks free users at the limit and increments metrics', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue('100')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: false, remaining: 0 })
      expect(metrics.rateLimitHits.inc).toHaveBeenCalledWith({ tier: 'free' })
    })

    it('blocks free users over the limit', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue('150')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: false, remaining: 0 })
    })

    it('treats corrupt redis values as zero instead of NaN', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue('not-a-number')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: true, remaining: 100 })
      expect(metrics.usageRedisErrors.inc).toHaveBeenCalledWith({ operation: 'corrupt_value' })
    })

    it('treats missing redis key as zero', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue(null)
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: true, remaining: 100 })
    })

    it('fails open and logs error if redis and DB both fail', async () => {
      vi.mocked(redisWriter.get).mockRejectedValue(new Error('Redis down'))
      vi.mocked(prisma.usage.findUnique).mockRejectedValue(new Error('DB down'))
      const result = await service.checkLimit('user-free', false)

      expect(result).toEqual({ allowed: true, remaining: 1 })
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'Rate limit check failed, falling back to DB',
        userId: 'user-free'
      }))
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'DB fallback failed for rate limit check',
        userId: 'user-free'
      }))
    })

    it('falls back to DB if redis fails and reset is today', async () => {
      vi.mocked(redisWriter.get).mockRejectedValue(new Error('Redis down'))
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({
        apiCallCountDaily: 20,
        lastApiCallReset: new Date('2026-04-25T01:00:00Z'),
      } as any)
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: true, remaining: 80 })
    })

    it('treats stale DB daily as zero when reset is from a previous UTC day', async () => {
      vi.mocked(redisWriter.get).mockRejectedValue(new Error('Redis down'))
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({
        apiCallCountDaily: 150,
        lastApiCallReset: new Date('2026-04-24T23:00:00Z'),
      } as any)
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: true, remaining: 100 })
    })

    it('uses DB fallback for unsafe userIds without touching redis', async () => {
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({
        apiCallCountDaily: 10,
        lastApiCallReset: new Date('2026-04-25T00:00:00Z'),
      } as any)
      const result = await service.checkLimit('user}evil', false)
      expect(redisWriter.get).not.toHaveBeenCalled()
      expect(result).toEqual({ allowed: true, remaining: 90 })
    })
  })

  describe('trackUsage', () => {
    const midnightUTC = Math.floor(Date.UTC(2026, 3, 26, 0, 0, 0, 0) / 1000)

    it('increments UTC daily key atomically via Lua and publishes with one eventId', async () => {
      await service.trackUsage('user-1')

      const dailyKey = 'rate_limit:{user-1}:daily:2026-04-25'

      expect(redisWriter.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCRBY'),
        1,
        dailyKey,
        '1',
        String(midnightUTC),
      )
      expect(analyticsPublisher.publish).toHaveBeenCalledWith('user-1', 1, expect.stringMatching(/^[0-9a-f-]{36}$/i))
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('reuses a caller-provided eventId for queue idempotency', async () => {
      const eventId = '123e4567-e89b-12d3-a456-426614174000'
      await service.trackUsage('user-1', { eventId })
      expect(analyticsPublisher.publish).toHaveBeenCalledWith('user-1', 1, eventId)
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('does NOT direct-write DB when Redis fails but queue succeeds (avoids double count)', async () => {
      vi.mocked(redisWriter.eval as any).mockRejectedValue(new Error('Redis down'))
      vi.mocked(analyticsPublisher.publish).mockResolvedValue('evt-1' as any)
      await service.trackUsage('user-1')

      expect(prisma.$executeRaw).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'Usage Redis unavailable, relying on queue flush for persistence',
      }))
    })

    it('sync-writes DB when publish fails but Redis succeeded (queue lost it, no double count)', async () => {
      vi.mocked(analyticsPublisher.publish).mockRejectedValue(new Error('Rabbit down'))
      await service.trackUsage('user-1')

      expect(prisma.$executeRaw).toHaveBeenCalled()
      expect(metrics.usageSyncFallback.inc).toHaveBeenCalledWith({ reason: 'queue_down' })
    })

    it('falls back to date-aware DB upsert when both Redis and queue fail', async () => {
      vi.mocked(redisWriter.eval as any).mockRejectedValue(new Error('Redis down'))
      vi.mocked(analyticsPublisher.publish).mockRejectedValue(new Error('Rabbit down'))
      await service.trackUsage('user-1')

      expect(prisma.$executeRaw).toHaveBeenCalled()
      expect(metrics.usageSyncFallback.inc).toHaveBeenCalledWith({ reason: 'redis_and_queue_down' })
    })

    it('logs DB fallback error if all three paths fail', async () => {
      vi.mocked(redisWriter.eval as any).mockRejectedValue(new Error('Redis down'))
      vi.mocked(analyticsPublisher.publish).mockRejectedValue(new Error('Rabbit down'))
      vi.mocked(prisma.$executeRaw).mockRejectedValue(new Error('DB down'))
      await service.trackUsage('user-1')

      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'DB fallback failed for trackUsage',
        userId: 'user-1'
      }))
    })

    it('skips invalid counts without side effects', async () => {
      await service.trackUsage('user-1', { count: 0 })
      expect(redisWriter.eval).not.toHaveBeenCalled()
      expect(analyticsPublisher.publish).not.toHaveBeenCalled()
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })
  })

  describe('getRealTimeUsage', () => {
    it('returns daily count from redis', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue('42')

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 42 })
      expect(prisma.usage.findUnique).not.toHaveBeenCalled()
    })

    it('returns zero if key does not exist in redis and DB is empty', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue(null)
      vi.mocked(prisma.usage.findUnique).mockResolvedValue(null as any)

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 0 })
    })

    it('returns zero for corrupt redis values', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue('garbage')

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 0 })
    })

    it('falls back to db if redis misses and reset is today', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue(null)
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({
        apiCallCountDaily: 25,
        lastApiCallReset: new Date('2026-04-25T05:00:00Z'),
      } as any)

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 25 })
    })

    it('returns zero when DB daily is stale (previous UTC day)', async () => {
      vi.mocked(redisWriter.get).mockResolvedValue(null)
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({
        apiCallCountDaily: 99,
        lastApiCallReset: new Date('2026-04-20T00:00:00Z'),
      } as any)

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 0 })
    })

    it('falls back to db if redis fails', async () => {
      vi.mocked(redisWriter.get).mockRejectedValue(new Error('Redis error'))
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({
        apiCallCountDaily: 25,
        lastApiCallReset: new Date('2026-04-25T00:00:00Z'),
      } as any)

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 25 })
    })

    it('returns zero if both redis and db fail', async () => {
      vi.mocked(redisWriter.get).mockRejectedValue(new Error('Redis error'))
      vi.mocked(prisma.usage.findUnique).mockRejectedValue(new Error('DB error'))

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 0 })
    })
  })
})
