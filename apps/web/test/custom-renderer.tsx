import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from 'next-auth/react'
import { type Session } from 'next-auth'
import { ThemeProvider } from '@/providers'
import { LazyMotionProvider } from '@/components/providers/lazy-motion-provider'

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })

interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  session?: Session | null
}

const renderWithProviders = (
  ui: React.ReactElement,
  { session = null, ...options }: ExtendedRenderOptions = {}
) => {
  const queryClient = createTestQueryClient()

  const AllProviders = ({ children }: { children: React.ReactNode }) => (
    <SessionProvider session={session}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <LazyMotionProvider>{children}</LazyMotionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SessionProvider>
  )

  return render(ui, { wrapper: AllProviders, ...options })
}

export * from '@testing-library/react'
export { renderWithProviders as render }
