import { vi } from 'vitest'

export const setupMetricsMocks = () => {
  vi.mock('@/lib/infrastructure/metrics', () => ({
    metrics: {
      rateLimitHits: { inc: vi.fn() },
      cacheOperations: { inc: vi.fn() },
      aiInferenceDuration: { observe: vi.fn() },
      httpRequestDuration: { observe: vi.fn() },
      dbQueryDuration: { observe: vi.fn() },
      apiCalls: { inc: vi.fn() },
    },
  }))
}
