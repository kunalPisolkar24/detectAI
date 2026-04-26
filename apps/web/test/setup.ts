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
    global.crypto.randomUUID = () => {
      return 'test-uuid-' + Math.random().toString(36).substring(7)
    }
  }
}

import '@testing-library/jest-dom'
import { expect, vi, afterAll, afterEach, beforeAll } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'
import './prisma-mock'
import { server } from './msw-server'

expect.extend(toHaveNoViolations)


beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

vi.mock('server-only', () => ({}))

vi.mock('@/lib/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key',
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test-paddle-token',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
    FILE_EXTRACTOR_API_URL: 'http://localhost:8000',
    INFERENCE_SERVICE_URL: 'localhost:50051',
  },
}))

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  
  const motionProps = [
    'initial', 'animate', 'exit', 'transition', 'variants', 
    'whileHover', 'whileTap', 'whileDrag', 'whileFocus', 'whileInView',
    'onAnimationStart', 'onAnimationComplete', 'onUpdate', 'onDragStart', 'onDragEnd', 'onDrag',
    'layout', 'layoutId'
  ]

  const filterProps = (props: any) => {
    const filtered = { ...props }
    motionProps.forEach(prop => delete filtered[prop])
    return filtered
  }

  const componentCache = new Map()

  const m: any = new Proxy({} as any, {
    get: (_target, tag: string) => {
      if (tag === '$$typeof') return undefined
      if (!componentCache.has(tag)) {
        const Component = React.forwardRef(({ children, ...props }: any, ref: any) =>
          React.createElement(tag, { ...filterProps(props), ref }, children)
        )
        Component.displayName = `m.${tag}`
        componentCache.set(tag, Component)
      }
      return componentCache.get(tag)
    }
  })

  return {
    ...actual,
    m,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    LazyMotion: ({ children }: { children: React.ReactNode }) => children,
    domAnimation: {},
  }
})

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/lib/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/infrastructure/metrics', () => ({
  metrics: {
    rateLimitHits: {
      inc: vi.fn(),
    },
    apiCalls: {
      inc: vi.fn(),
    },
  },
}))

vi.mock('next/font/google', () => ({
  Merriweather: () => ({ className: 'merriweather' }),
  Inter: () => ({ className: 'inter' }),
  Teko: () => ({ className: 'teko' }),
  Outfit: () => ({ className: 'outfit' }),
  Roboto: () => ({ className: 'roboto' }),
}))

vi.mock('ioredis', () => {
  class MockRedis {
    get = vi.fn()
    set = vi.fn()
    del = vi.fn()
    on = vi.fn()
  }
  return {
    default: MockRedis,
    Redis: MockRedis,
  }
})
