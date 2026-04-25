import React from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from 'next-auth/react'
import { type Session } from 'next-auth'

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  session?: Session | null
}

const createWrapper = (session: Session | null = null) => {
  const queryClient = createTestQueryClient()

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <SessionProvider session={session}>{children}</SessionProvider>
    </QueryClientProvider>
  )

  Wrapper.displayName = 'TestWrapper'
  return Wrapper
}

const renderWithProviders = (
  ui: React.ReactElement,
  { session = null, ...options }: RenderWithProvidersOptions = {},
) => render(ui, { wrapper: createWrapper(session), ...options })

export * from '@testing-library/react'
export { renderWithProviders as render }
