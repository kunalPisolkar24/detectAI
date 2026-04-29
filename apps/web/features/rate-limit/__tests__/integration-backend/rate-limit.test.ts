import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rateLimitService } from '../../services/rate-limit-service'
import { usageRedis } from '@/lib/infrastructure/redis-limit'

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

  it('tracks usage by incrementing daily and pending keys', async () => {
    const userId = 'user-1'
    
    await rateLimitService.trackUsage(userId)
    
    expect(usageRedis.pipeline).toHaveBeenCalled()
    expect(usageRedis.sadd).toHaveBeenCalledWith('usage:dirty_users', userId)
  })

  it('retrieves real-time usage correctly', async () => {
    vi.mocked(usageRedis.get)
      .mockResolvedValueOnce('42') // daily
      .mockResolvedValueOnce('5')  // pending
      
    const usage = await rateLimitService.getRealTimeUsage('user-1')
    
    expect(usage.dailyCount).toBe(42)
    expect(usage.pendingCount).toBe(5)
  })
})
