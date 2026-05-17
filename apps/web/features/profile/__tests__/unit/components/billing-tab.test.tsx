import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { BillingTab } from '../../../components/billing-tab'
import { useRouter } from 'next/navigation'
import { cancelSubscriptionAction } from '../../../actions/cancel-subscription'
import { toast } from 'sonner'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../../actions/cancel-subscription', () => ({
  cancelSubscriptionAction: vi.fn(),
}))

vi.mock('@/lib/core/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
  inter: { className: 'inter' },
}))

describe('BillingTab', () => {
  const mockPush = vi.fn()
  const mockUser = {
    isPremium: false,
    subscriptionEndsAt: null,
    paddleSubscriptionStatus: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRouter).mockReturnValue({ push: mockPush } as any)
  })

  it('renders free plan state correctly', () => {
    render(<BillingTab user={mockUser} paddleCancellationScheduled={false} />)
    
    expect(screen.getByText('Free Plan')).toBeInTheDocument()
    expect(screen.getByText(/limited free tier/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /UPGRADE NOW/i })).toBeInTheDocument()
  })

  it('redirects to upgrade page when clicking upgrade button', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<BillingTab user={mockUser} paddleCancellationScheduled={false} />)
    
    await user.click(screen.getByRole('button', { name: /UPGRADE NOW/i }))
    expect(mockPush).toHaveBeenCalledWith('/upgrade')
  })

  it('renders premium plan state correctly', () => {
    const premiumUser = {
      ...mockUser,
      isPremium: true,
      subscriptionEndsAt: new Date('2026-05-18'),
      paddleSubscriptionStatus: 'active',
    }
    render(<BillingTab user={premiumUser} paddleCancellationScheduled={false} />)
    
    expect(screen.getByText('Premium Plan')).toBeInTheDocument()
    expect(screen.getByText(/advanced AI detection models/i)).toBeInTheDocument()
    expect(screen.getByText('May 18, 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /CANCEL SUBSCRIPTION/i })).toBeInTheDocument()
  })

  it('handles subscription cancellation flow successfully', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const premiumUser = {
      ...mockUser,
      isPremium: true,
      subscriptionEndsAt: new Date('2026-05-18'),
    }
    vi.mocked(cancelSubscriptionAction).mockResolvedValue({ error: null } as any)
    
    render(<BillingTab user={premiumUser} paddleCancellationScheduled={false} />)
    
    await user.click(screen.getByRole('button', { name: /CANCEL SUBSCRIPTION/i }))
    
    // Check if dialog opened
    expect(screen.getByText(/Confirm Cancellation/i)).toBeInTheDocument()
    
    await user.click(screen.getByRole('button', { name: /YES, CANCEL PLAN/i }))
    
    expect(cancelSubscriptionAction).toHaveBeenCalled()
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('successfully'))
    })
  })

  it('shows error toast if cancellation fails', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const premiumUser = {
      ...mockUser,
      isPremium: true,
      subscriptionEndsAt: new Date('2026-05-18'),
    }
    vi.mocked(cancelSubscriptionAction).mockResolvedValue({ error: 'Failed to cancel' } as any)
    
    render(<BillingTab user={premiumUser} paddleCancellationScheduled={false} />)
    
    await user.click(screen.getByRole('button', { name: /CANCEL SUBSCRIPTION/i }))
    await user.click(screen.getByRole('button', { name: /YES, CANCEL PLAN/i }))
    
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to cancel')
    })
  })

  it('renders scheduled cancellation state correctly', () => {
    const premiumUser = {
      ...mockUser,
      isPremium: true,
      subscriptionEndsAt: new Date('2026-05-18'),
    }
    render(<BillingTab user={premiumUser} paddleCancellationScheduled={true} />)
    
    expect(screen.getByText(/Cancellation scheduled/i)).toBeInTheDocument()
    expect(screen.getByText(/remains active until/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /CANCEL SUBSCRIPTION/i })).not.toBeInTheDocument()
  })
})
