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
})
