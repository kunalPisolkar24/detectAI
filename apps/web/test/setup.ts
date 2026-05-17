import React from 'react'

// Polyfills for JSDOM
if (typeof window !== 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  global.PointerEvent = class PointerEvent extends Event {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init)
    }
  } as unknown as typeof PointerEvent

  window.HTMLElement.prototype.scrollIntoView = vi.fn()

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  if (!global.crypto) {
    // @ts-ignore
    global.crypto = {}
  }
  if (!global.crypto.randomUUID) {
    global.crypto.randomUUID = (() => {
      return 'test-uuid-' + Math.random().toString(36).substring(7)
    }) as any
  }
}

import '@testing-library/jest-dom'
import { expect, vi, afterAll, afterEach, beforeAll } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'
import { server } from './msw-server'
import { setupEnvMocks } from './infrastructure/env'
import { setupCommonMocks } from './infrastructure/common'
import { setupMetricsMocks } from './infrastructure/metrics'
import { setupRedisMocks } from './infrastructure/redis'
import { setupPrismaMocks } from './infrastructure/prisma'
import { setupUIMocks } from './infrastructure/ui'
import { useChatUIStore } from '@/features/chat/stores/ui-store'

expect.extend(toHaveNoViolations)

// Apply modular mocks
setupEnvMocks()
setupCommonMocks()
setupMetricsMocks()
setupRedisMocks()
setupPrismaMocks()
setupUIMocks()

// MSW & Store Lifecycle
const initialChatUIState = useChatUIStore.getState()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  useChatUIStore.setState(initialChatUIState, true)
})
afterAll(() => server.close())

vi.mock('server-only', () => ({}))
