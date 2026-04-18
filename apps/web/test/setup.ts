import React from 'react'
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

vi.mock('@/lib/env', () => ({
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
  return {
    ...actual,
    m: new Proxy({}, {
      get: (_target, tag: string) =>
        ({ children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) =>
          React.createElement(tag, props, children),
    }),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    LazyMotion: ({ children }: { children: React.ReactNode }) => children,
    domAnimation: {},
  }
})
