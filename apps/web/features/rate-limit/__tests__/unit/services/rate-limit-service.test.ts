import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RedisRateLimitService } from '../../../services/rate-limit-service'
import { usageRedis } from '@/lib/infrastructure/redis-limit'
import { metrics } from '@/lib/infrastructure/metrics'
import { logger } from '@/lib/infrastructure/logger'
import { analyticsPublisher } from '@/lib/infrastructure/analytics-publisher'
import { prisma } from '@/lib/infrastructure/prisma'

vi.mock('@/lib/infrastructure/redis-limit', () => ({
  usageRedis: {
    get: vi.fn(),
    pipeline: vi.fn(),
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
  },
}))

describe('RedisRateLimitService', () => {
  let service: RedisRateLimitService
  const mockPipeline = {
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'))
    service = new RedisRateLimitService()
    vi.mocked(usageRedis.pipeline).mockReturnValue(mockPipeline as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates correct daily key based on current date', async () => {
    vi.mocked(usageRedis.get).mockResolvedValue('0')
    await service.checkLimit('user-1', false)
    expect(usageRedis.get).toHaveBeenCalledWith('rate_limit:{user-1}:daily:2026-04-25')
  })

  describe('checkLimit', () => {
    it('allows premium users immediately without calling redis', async () => {
      const result = await service.checkLimit('user-premium', true)
      expect(result).toEqual({ allowed: true, remaining: -1 })
      expect(usageRedis.get).not.toHaveBeenCalled()
    })

    it('allows free users under the limit', async () => {
      vi.mocked(usageRedis.get).mockResolvedValue('99')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: true, remaining: 1 })
    })

    it('blocks free users at the limit and increments metrics', async () => {
      vi.mocked(usageRedis.get).mockResolvedValue('100')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: false, remaining: 0 })
      expect(metrics.rateLimitHits.inc).toHaveBeenCalledWith({ tier: 'free' })
    })

    it('blocks free users over the limit', async () => {
      vi.mocked(usageRedis.get).mockResolvedValue('150')
      const result = await service.checkLimit('user-free', false)
      expect(result).toEqual({ allowed: false, remaining: 0 })
    })

    it('fails open and logs error if redis call fails', async () => {
      vi.mocked(usageRedis.get).mockRejectedValue(new Error('Redis down'))
      const result = await service.checkLimit('user-free', false)
      
      expect(result).toEqual({ allowed: true, remaining: 1 })
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'Rate limit check failed',
        userId: 'user-free'
      }))
    })
  })

  describe('trackUsage', () => {
    it('increments daily key and publishes to rabbitmq', async () => {
      mockPipeline.exec.mockResolvedValue([])
      await service.trackUsage('user-1')

      const dailyKey = 'rate_limit:{user-1}:daily:2026-04-25'

      expect(mockPipeline.incr).toHaveBeenCalledWith(dailyKey)
      expect(mockPipeline.expire).toHaveBeenCalledWith(dailyKey, 86400)
      expect(mockPipeline.exec).toHaveBeenCalled()
      expect(analyticsPublisher.publish).toHaveBeenCalledWith('user-1', 1)
    })

    it('logs error if pipeline execution fails', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Pipeline failed'))
      await service.trackUsage('user-1')

      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'Failed to track usage metrics',
        userId: 'user-1'
      }))
    })
  })

  describe('getRealTimeUsage', () => {
    it('returns daily count from redis', async () => {
      vi.mocked(usageRedis.get).mockResolvedValue('42')

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 42 })
    })

    it('returns zero if key does not exist in redis', async () => {
      vi.mocked(usageRedis.get).mockResolvedValue(null)

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 0 })
    })

    it('falls back to db if redis fails', async () => {
      vi.mocked(usageRedis.get).mockRejectedValue(new Error('Redis error'))
      vi.mocked(prisma.usage.findUnique).mockResolvedValue({ apiCallCountDaily: 25 } as any)

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 25 })
    })

    it('returns zero if both redis and db fail', async () => {
      vi.mocked(usageRedis.get).mockRejectedValue(new Error('Redis error'))
      vi.mocked(prisma.usage.findUnique).mockRejectedValue(new Error('DB error'))

      const result = await service.getRealTimeUsage('user-1')
      expect(result).toEqual({ dailyCount: 0 })
    })
  })
})
