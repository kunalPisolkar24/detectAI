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
  class MockRedis {
    get = vi.fn()
    set = vi.fn()
    del = vi.fn()
    on = vi.fn()
    pipeline = vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }))
    sadd = vi.fn()
  }
  return {
    default: MockRedis,
    Redis: MockRedis,
  }
})

// Mock Prisma for integration tests (using vitest-mock-extended)
vi.mock('@/lib/infrastructure/prisma', () => {
  const { mockDeep } = require('vitest-mock-extended')
  return {
    prisma: mockDeep(),
  }
})
