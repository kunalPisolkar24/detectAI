import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RedisRateLimitService } from './rate-limit-service'
import { usageRedis } from '@/lib/redis-limit'
import { metrics } from '@/lib/metrics'
import { logger } from '@/lib/logger'

vi.mock('@/lib/redis-limit', () => ({
  usageRedis: {
    get: vi.fn(),
    pipeline: vi.fn(),
    sadd: vi.fn(),
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
})
