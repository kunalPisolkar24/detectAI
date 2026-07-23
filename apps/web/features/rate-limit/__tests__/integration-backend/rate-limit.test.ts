import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rateLimitService } from '../../services/rate-limit-service'
import { usageRedis } from '@/lib/infrastructure/redis-limit'
import { analyticsPublisher } from '@/lib/infrastructure/analytics-publisher'

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

describe('RedisRateLimitService Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows request when under limit for free user', async () => {
    vi.mocked(usageRedis.get).mockResolvedValue('50')
    
    const result = await rateLimitService.checkLimit('user-1', false)
    
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(50)
  })

  it('denies request when over limit for free user', async () => {
    vi.mocked(usageRedis.get).mockResolvedValue('100')
    
    const result = await rateLimitService.checkLimit('user-1', false)
    
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('always allows premium users', async () => {
    const result = await rateLimitService.checkLimit('user-premium', true)
    
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(-1)
  })

  it('tracks usage by incrementing daily key and publishing to rabbitmq', async () => {
    const mockPipeline = { incr: vi.fn().mockReturnThis(), expire: vi.fn().mockReturnThis(), exec: vi.fn().mockResolvedValue([]) }
    vi.mocked(usageRedis.pipeline).mockReturnValue(mockPipeline as any)

    await rateLimitService.trackUsage('user-1')

    expect(usageRedis.pipeline).toHaveBeenCalled()
    expect(analyticsPublisher.publish).toHaveBeenCalledWith('user-1', 1)
  })

  it('retrieves real-time usage correctly from redis', async () => {
    vi.mocked(usageRedis.get).mockResolvedValue('42')
      
    const usage = await rateLimitService.getRealTimeUsage('user-1')
    
    expect(usage.dailyCount).toBe(42)
  })
})
