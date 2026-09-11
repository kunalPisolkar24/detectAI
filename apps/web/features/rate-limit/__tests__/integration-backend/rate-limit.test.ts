import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rateLimitService } from '../../services/rate-limit-service'
import { redis } from '@/lib/infrastructure/redis'
import { analyticsPublisher } from '@/lib/infrastructure/analytics-publisher'

vi.mock('@/lib/infrastructure/redis', () => ({
  redis: {
    get: vi.fn(),
    eval: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
  },
  redisWriter: {
    get: vi.fn(),
    eval: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
  },
  redisReader: { get: vi.fn() },
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

describe('RedisRateLimitService Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows request when under limit for free user', async () => {
    vi.mocked(redis.get).mockResolvedValue('50')

    const result = await rateLimitService.checkLimit('user-1', false)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(50)
  })

  it('denies request when over limit for free user', async () => {
    vi.mocked(redis.get).mockResolvedValue('100')

    const result = await rateLimitService.checkLimit('user-1', false)

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('always allows premium users', async () => {
    const result = await rateLimitService.checkLimit('user-premium', true)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(-1)
  })

  it('tracks usage by atomically incrementing UTC daily key and publishing with eventId', async () => {
    vi.mocked(redis.eval as any).mockResolvedValue(1)
    vi.mocked(analyticsPublisher.publish).mockResolvedValue('evt-1' as any)

    await rateLimitService.trackUsage('user-1')

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCRBY'),
      1,
      expect.stringContaining('rate_limit:user-1:daily:'),
      '1',
      expect.any(String),
    )
    expect(analyticsPublisher.publish).toHaveBeenCalledWith('user-1', 1, expect.any(String))
  })

  it('retrieves real-time usage correctly from redis', async () => {
    vi.mocked(redis.get).mockResolvedValue('42')

    const usage = await rateLimitService.getRealTimeUsage('user-1')

    expect(usage.dailyCount).toBe(42)
  })
})
