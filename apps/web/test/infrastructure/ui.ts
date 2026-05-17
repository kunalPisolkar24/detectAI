import React from 'react'
import { vi } from 'vitest'

export const setupUIMocks = () => {
  // Mock framer-motion
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

  // Mock next/navigation
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

  // Mock next-auth/react
  vi.mock('next-auth/react', () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
    useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  }))

  // Mock sonner
  vi.mock('sonner', () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }))

  // Mock next/font/google
  vi.mock('next/font/google', () => ({
    Merriweather: () => ({ className: 'merriweather' }),
    Inter: () => ({ className: 'inter' }),
    Teko: () => ({ className: 'teko' }),
    Outfit: () => ({ className: 'outfit' }),
    Roboto: () => ({ className: 'roboto' }),
  }))
}
