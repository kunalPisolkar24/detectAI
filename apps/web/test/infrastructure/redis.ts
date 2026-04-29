import { vi } from 'vitest'

export const mockPipeline = {
  get: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  incr: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn().mockResolvedValue([]),
}

export const mockRedis = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(0),
  on: vi.fn(),
  pipeline: vi.fn(() => mockPipeline),
  sadd: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
  srem: vi.fn().mockResolvedValue(1),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  quit: vi.fn().mockResolvedValue('OK'),
}

export const setupRedisMocks = () => {
  vi.mock('ioredis', () => {
    class MockRedis {
      constructor() { return mockRedis }
      static Cluster = class { constructor() { return mockRedis } }
      pipeline() { return mockPipeline }
      get(key: string) { return mockRedis.get(key) }
      set(key: string, val: string) { return mockRedis.set(key, val) }
      setex(key: string, ttl: number, val: string) { return mockRedis.setex(key, ttl, val) }
      del(...args: any[]) { return mockRedis.del(...args) }
      sadd(...args: any[]) { return mockRedis.sadd(...args) }
    }

    return {
      default: MockRedis,
      Redis: MockRedis,
      Cluster: MockRedis.Cluster,
    }
  })

  // Mock internal redis instances
  vi.mock('@/lib/infrastructure/redis', () => ({
    redisReader: mockRedis,
    redisWriter: mockRedis,
  }))

  vi.mock('@/lib/infrastructure/redis-limit', () => ({
    usageRedis: mockRedis,
  }))
}
