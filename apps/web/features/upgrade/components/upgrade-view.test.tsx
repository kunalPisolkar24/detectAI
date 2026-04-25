import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import { UpgradeView } from './upgrade-view'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { initializePaddle } from '@paddle/paddle-js'
import { toast } from 'sonner'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return {
    ...actual,
    useSession: vi.fn(),
  }
})

vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test-token',
  },
}))

vi.mock('@/lib/fonts', () => ({
  teko: { className: 'teko' },
}))

vi.mock('@/features/landing/pricing', () => ({
  Pricing: ({ onPlanSelect, isProcessing }: any) => (
    <div data-testid="pricing-component">
      <button 
        data-testid="select-monthly" 
        onClick={() => onPlanSelect('flare', 'monthly')}
        disabled={isProcessing}
      >
        Select Monthly
      </button>
      <button 
        data-testid="select-yearly" 
        onClick={() => onPlanSelect('flare', 'yearly')}
        disabled={isProcessing}
      >
        Select Yearly
      </button>
      {isProcessing && <span>Loading Paddle...</span>}
    </div>
  ),
}))

describe('UpgradeView', () => {
  const mockPush = vi.fn()
  const mockBack = vi.fn()
  const mockUpdate = vi.fn()
  const mockPaddle = {
    Checkout: {
      open: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      back: mockBack,
    } as any)
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: mockUpdate,
    } as any)
    vi.mocked(initializePaddle).mockResolvedValue(mockPaddle as any)
  })

  it('smoke test: renders correctly', () => {
    render(<UpgradeView />)
    expect(screen.getByTestId('pricing-component')).toBeInTheDocument()
    expect(screen.getByText('Back')).toBeInTheDocument()
  })
})
