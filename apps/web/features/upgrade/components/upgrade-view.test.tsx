import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@/test/test-utils'
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

  it('initializes paddle on mount', async () => {
    render(<UpgradeView />)
    
    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalledWith({
        token: 'test-token',
        environment: 'sandbox',
        eventCallback: expect.any(Function),
      })
    })
  })

  it('shows error toast if paddle initialization fails', async () => {
    vi.mocked(initializePaddle).mockRejectedValue(new Error('Init failed'))
    render(<UpgradeView />)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to load payment system')
    })
  })

  it('sets processing state during paddle initialization', async () => {
    let resolvePaddle: any
    const paddlePromise = new Promise((resolve) => {
      resolvePaddle = resolve
    })
    vi.mocked(initializePaddle).mockReturnValue(paddlePromise as any)

    render(<UpgradeView />)

    expect(screen.getByText('Loading Paddle...')).toBeInTheDocument()

    await act(async () => {
      resolvePaddle(mockPaddle)
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading Paddle...')).not.toBeInTheDocument()
    })
  })

  it('redirects to login if selecting plan while unauthenticated', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: mockUpdate,
    } as any)

    render(<UpgradeView />)
    
    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalled()
    })

    const selectBtn = screen.getByTestId('select-monthly')
    await act(async () => {
      selectBtn.click()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Please log in to upgrade.')
      expect(mockPush).toHaveBeenCalledWith('/login?callbackUrl=/upgrade')
    })
  })

  it('shows error if paddle is not initialized when selecting plan', async () => {
    vi.mocked(initializePaddle).mockResolvedValue(undefined as any)
    
    render(<UpgradeView />)

    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalled()
    })
    
    const selectBtn = screen.getByTestId('select-monthly')
    await act(async () => {
      selectBtn.click()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Payment system is still loading. Please try again.')
    })
  })

  it('opens monthly checkout for authenticated user', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      status: 'authenticated',
      update: mockUpdate,
    } as any)

    render(<UpgradeView />)
    
    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalled()
    })

    const selectBtn = screen.getByTestId('select-monthly')
    await act(async () => {
      selectBtn.click()
    })

    expect(mockPaddle.Checkout.open).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_01jr2gqggwjakpc1hd9xzym7fy', quantity: 1 }],
      customer: { email: 'test@example.com' },
      customData: { userId: 'user-123' },
      settings: { theme: 'dark', displayMode: 'overlay' },
    })
  })

  it('opens yearly checkout for authenticated user', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      status: 'authenticated',
      update: mockUpdate,
    } as any)

    render(<UpgradeView />)
    
    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalled()
    })

    const selectBtn = screen.getByTestId('select-yearly')
    await act(async () => {
      selectBtn.click()
    })

    expect(mockPaddle.Checkout.open).toHaveBeenCalledWith({
      items: [{ priceId: 'pri_01jr2gs8ckz66srr8sd1byh7n4', quantity: 1 }],
      customer: { email: 'test@example.com' },
      customData: { userId: 'user-123' },
      settings: { theme: 'dark', displayMode: 'overlay' },
    })
  })

  describe.skip('checkout lifecycle', () => {
    let originalSetTimeout: typeof setTimeout

    beforeEach(() => {
      originalSetTimeout = global.setTimeout
      vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        cb()
        return 0 as any
      })
    })

    afterEach(() => {
      global.setTimeout = originalSetTimeout
    })

    it('polls and redirects on successful premium activation', async () => {
      let eventCallback: any
      vi.mocked(initializePaddle).mockImplementation(async (options: any) => {
        eventCallback = options.eventCallback
        return mockPaddle as any
      })

      vi.mocked(useSession).mockReturnValue({
        data: { user: { id: 'user-123', isPremium: false } },
        status: 'authenticated',
        update: mockUpdate,
      } as any)

      render(<UpgradeView />)
      
      await waitFor(() => {
        expect(eventCallback).toBeDefined()
      })

      mockUpdate.mockResolvedValueOnce({ user: { isPremium: false } })
      mockUpdate.mockResolvedValueOnce({ user: { isPremium: true } })

      await act(async () => {
        await eventCallback({ name: 'checkout.completed' })
      })

      expect(toast.success).toHaveBeenCalledWith('Payment received! Activating your Premium access…')
      expect(toast.success).toHaveBeenCalledWith('Premium activated! Welcome to Flare.')
      expect(mockPush).toHaveBeenCalledWith('/chat')
    })

    it('handles polling timeout gracefully', async () => {
      let eventCallback: any
      vi.mocked(initializePaddle).mockImplementation(async (options: any) => {
        eventCallback = options.eventCallback
        return mockPaddle as any
      })

      vi.mocked(useSession).mockReturnValue({
        data: { user: { id: 'user-123', isPremium: false } },
        status: 'authenticated',
        update: mockUpdate,
      } as any)

      render(<UpgradeView />)
      
      await waitFor(() => {
        expect(eventCallback).toBeDefined()
      })

      mockUpdate.mockResolvedValue({ user: { isPremium: false } })

      await act(async () => {
        await eventCallback({ name: 'checkout.completed' })
      })

      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining('Your subscription is being processed')
      )
      expect(mockPush).toHaveBeenCalledWith('/chat')
    })
  })
})
