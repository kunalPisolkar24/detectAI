import { vi, beforeAll, afterAll, afterEach } from 'vitest'
import { server } from './msw-server'


// Mock environment variables
vi.mock('@/lib/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key',
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test-paddle-token',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
    FILE_EXTRACTOR_API_URL: 'http://localhost:8000',
    INFERENCE_SERVICE_URL: 'localhost:50051',
    REDIS_MODE: 'standalone',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_PASSWORD: 'test-password',
  },
}))

// Start MSW server
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// Mock logger to avoid cluttering test output
vi.mock('@/lib/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock metrics
vi.mock('@/lib/infrastructure/metrics', () => ({
  metrics: {
    rateLimitHits: { inc: vi.fn() },
    apiCalls: { inc: vi.fn() },
  },
}))

// Mock ioredis
vi.mock('ioredis', () => {
  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(0),
    on: vi.fn(),
    pipeline: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
    sadd: vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    srem: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  }

  class MockRedis {
    constructor() { return mockRedis }
    static Cluster = class { constructor() { return mockRedis } }
  }

  return {
    default: MockRedis,
    Redis: MockRedis,
    Cluster: MockRedis.Cluster,
  }
})

// Centralized Redis Mocks
import Redis from 'ioredis'
const mockRedisInstance = new Redis()

vi.mock('@/lib/infrastructure/redis', () => ({
  redisReader: mockRedisInstance,
  redisWriter: mockRedisInstance,
}))

vi.mock('@/lib/infrastructure/redis-limit', () => ({
  usageRedis: mockRedisInstance,
}))

// Mock lock service
vi.mock('@/lib/services/lock-service', () => ({
  lockService: {
    execute: vi.fn((_keys, task) => task()),
  },
}))

// Mock Prisma for integration tests (using vitest-mock-extended)
vi.mock('@/lib/infrastructure/prisma', async () => {
  const { mockDeep } = await import('vitest-mock-extended')
  return {
    prisma: mockDeep(),
  }
})
