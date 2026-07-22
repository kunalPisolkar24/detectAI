import { vi } from 'vitest'

export const setupCommonMocks = () => {
  // Mock logger
  vi.mock('@/lib/infrastructure/logger', () => ({
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }))

  // Mock lock service
  vi.mock('@/lib/services/lock-service', () => ({
    lockService: {
      execute: vi.fn((_keys, task) => task()),
      executeMulti: vi.fn((_keys, task) => task()),
    },
  }))

  // Mock server-only
  vi.mock('server-only', () => ({}))
}
