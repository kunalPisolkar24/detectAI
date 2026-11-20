import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  RedisAbuseRateLimitService,
  extractClientIp,
  getAbuseRateLimitHeaders,
  resetAbuseRateLimitMemoryForTests,
} from '../../../services/abuse-rate-limit-service'
import { metrics } from '@/lib/infrastructure/metrics'
import { logger } from '@/lib/infrastructure/logger'
import { redis } from '@/lib/infrastructure/redis'

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
  },
  redisReader: {
    get: vi.fn(),
  },
}))

describe('RedisAbuseRateLimitService', () => {
  let service: RedisAbuseRateLimitService
  const windowMs = 60000
  const now = 1_700_000_000_000

  beforeEach(() => {
    vi.resetAllMocks()
    resetAbuseRateLimitMemoryForTests()
    service = new RedisAbuseRateLimitService()
    vi.mocked(redis.eval as any).mockResolvedValue(1)
  })

  it('allows requests under the analyze limit via Redis', async () => {
    vi.mocked(redis.eval as any).mockResolvedValue(5)
    const result = await service.consume({ scope: 'analyze', ip: '1.2.3.4', userId: 'user-1', now })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(15)
    expect(result.limit).toBe(20)
    expect(result.degraded).toBe(false)
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('INCR'),
      1,
      expect.stringContaining('abuse:analyze:'),
      String(windowMs),
    )
  })

  it('prefers userId key when authenticated', async () => {
    await service.consume({ scope: 'analyze', ip: '9.9.9.9', userId: 'user-abc', now })
    const key = vi.mocked(redis.eval as any).mock.calls[0][2] as string
    expect(key).toContain('u:user-abc')
    expect(key).not.toContain('9.9.9.9')
  })

  it('hashes IP for anonymous identifiers instead of storing raw IP', async () => {
    await service.consume({ scope: 'default', ip: '5.6.7.8', now })
    const key = vi.mocked(redis.eval as any).mock.calls[0][2] as string
    expect(key).toContain('abuse:default:ip:')
    expect(key).not.toContain('5.6.7.8')
  })

  it('uses a shared unknown bucket when neither IP nor user is present', async () => {
    await service.consume({ scope: 'default', now })
    const key = vi.mocked(redis.eval as any).mock.calls[0][2] as string
    expect(key).toContain('ip:unknown')
  })

  it('blocks over the limit with retryAfter and records a hit', async () => {
    vi.mocked(redis.eval as any).mockResolvedValue(21)
    const result = await service.consume({ scope: 'analyze', ip: '1.2.3.4', userId: 'user-1', now })
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterMs).toBeGreaterThan(0)
    expect(metrics.abuseRateLimitHits.inc).toHaveBeenCalledWith({ scope: 'analyze' })
  })

  it('anchors keys to the fixed window', async () => {
    await service.consume({ scope: 'default', ip: '1.1.1.1', now })
    await service.consume({ scope: 'default', ip: '1.1.1.1', now: now + windowMs })
    const keys = vi.mocked(redis.eval as any).mock.calls.map((c) => c[2] as string)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('allows on corrupt Redis values instead of false-blocking', async () => {
    vi.mocked(redis.eval as any).mockResolvedValue('not-a-number')
    const result = await service.consume({ scope: 'default', ip: '1.1.1.1', now })
    expect(result.allowed).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining('Unexpected abuse counter') }))
  })

  it('falls back to in-memory counting when Redis is down', async () => {
    vi.mocked(redis.eval as any).mockRejectedValue(new Error('Redis down'))
    const first = await service.consume({ scope: 'default', ip: '2.2.2.2', now })
    expect(first.allowed).toBe(true)
    expect(first.degraded).toBe(true)
    expect(metrics.abuseRedisErrors.inc).toHaveBeenCalledWith({ operation: 'incr' })

    const second = await service.consume({ scope: 'default', ip: '2.2.2.2', now: now + 1000 })
    expect(second.degraded).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ msg: expect.stringContaining('in-memory fallback') }))
  })

  it('enforces the limit in degraded memory mode and resets next window', async () => {
    vi.mocked(redis.eval as any).mockRejectedValue(new Error('Redis down'))
    const scopeNow = 60_000 * 1000
    for (let i = 0; i < 120; i++) {
      await service.consume({ scope: 'default', ip: '3.3.3.3', now: scopeNow })
    }
    const blocked = await service.consume({ scope: 'default', ip: '3.3.3.3', now: scopeNow + 1000 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.degraded).toBe(true)
    expect(metrics.abuseRateLimitHits.inc).toHaveBeenCalledWith({ scope: 'default' })

    const nextWindow = await service.consume({ scope: 'default', ip: '3.3.3.3', now: scopeNow + windowMs + 1 })
    expect(nextWindow.allowed).toBe(true)
  })

  describe('extractClientIp', () => {
    it('prefers the first X-Forwarded-For entry', () => {
      const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
      expect(extractClientIp(headers)).toBe('1.2.3.4')
    })

    it('falls back to X-Real-IP', () => {
      const headers = new Headers({ 'x-real-ip': '9.9.9.9' })
      expect(extractClientIp(headers)).toBe('9.9.9.9')
    })

    it('returns null when no IP headers exist', () => {
      expect(extractClientIp(new Headers())).toBeNull()
    })
  })

  describe('getAbuseRateLimitHeaders', () => {
    it('emits rate-limit headers without Retry-After when allowed', () => {
      const headers = getAbuseRateLimitHeaders({ allowed: true, remaining: 10, limit: 20, windowMs: 60000, retryAfterMs: 0, degraded: false })
      expect(headers['RateLimit-Limit']).toBe('20')
      expect(headers['RateLimit-Remaining']).toBe('10')
      expect(headers['Retry-After']).toBeUndefined()
    })

    it('emits Retry-After when blocked', () => {
      const headers = getAbuseRateLimitHeaders({ allowed: false, remaining: 0, limit: 20, windowMs: 60000, retryAfterMs: 15000, degraded: false })
      expect(headers['Retry-After']).toBe('15')
      expect(headers['RateLimit-Reset']).toBe('15')
    })
  })
})
