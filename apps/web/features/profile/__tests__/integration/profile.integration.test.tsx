import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ProfileView } from '../../components/profile-view'
import { render } from '@/test/custom-renderer'
import { useSession } from 'next-auth/react'
import { updateProfileAction } from '../../actions/update-profile'
import { toast } from 'sonner'

vi.mock('../../actions/update-profile', () => ({
  updateProfileAction: vi.fn(),
}))

vi.mock('../../actions/cancel-subscription', () => ({
  cancelSubscriptionAction: vi.fn(),
}))

const mockUser = {
  id: 'user-123',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  image: null,
  createdAt: new Date('2024-01-01'),
  isPremium: false,
  apiCallCountDaily: 10,
  apiCallCountTotal: 100,
  subscriptionEndsAt: null,
  paddleSubscriptionStatus: null,
  paddleCancellationScheduled: false,
}

describe('Profile Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' } },
      status: 'authenticated',
      update: vi.fn(),
    } as any)
  })

  it('renders profile information correctly', () => {
    render(<ProfileView user={mockUser} />)

    expect(screen.getByText(/John Doe/i)).toBeInTheDocument()
    expect(screen.getByText(/john@example.com/i)).toBeInTheDocument()
    expect(screen.getByText(/Free Plan/i)).toBeInTheDocument()
  })

  it('updates profile name successfully', async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({ success: true })
    
    render(<ProfileView user={mockUser} />)

    fireEvent.click(screen.getByRole('button', { name: /Edit Profile/i }))

    const firstNameInput = screen.getByLabelText(/First Name/i)
    const lastNameInput = screen.getByLabelText(/Last Name/i)

    fireEvent.change(firstNameInput, { target: { value: 'Jane' } })
    fireEvent.change(lastNameInput, { target: { value: 'Smith' } })

    fireEvent.click(screen.getByRole('button', { name: /SAVE/i }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Profile updated successfully')
    })
    expect(updateProfileAction).toHaveBeenCalledWith({
      firstName: 'Jane',
      lastName: 'Smith',
    })
  })

  it('switches between tabs', async () => {
    render(<ProfileView user={mockUser} />)

    const billingButton = screen.getAllByRole('button', { name: /Billing/i })[0]
    fireEvent.click(billingButton)

    expect(screen.getByText(/Subscription/i)).toBeInTheDocument()
    expect(screen.queryByText(/Account Details/i)).not.toBeInTheDocument()

    const generalButton = screen.getAllByRole('button', { name: /General/i })[0]
    fireEvent.click(generalButton)

    expect(screen.getByText(/Account Details/i)).toBeInTheDocument()
  })

  it('handles profile update error', async () => {
    vi.mocked(updateProfileAction).mockResolvedValue({ error: 'Update failed' })

    render(<ProfileView user={mockUser} />)

    fireEvent.click(screen.getByRole('button', { name: /Edit Profile/i }))
    fireEvent.click(screen.getByRole('button', { name: /SAVE/i }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Update failed')
    })
  })

  it('handles subscription cancellation', async () => {
    const { cancelSubscriptionAction } = await import('../../actions/cancel-subscription')
    vi.mocked(cancelSubscriptionAction).mockResolvedValue({ success: true })

    render(<ProfileView user={{ ...mockUser, isPremium: true }} />)

    const billingButton = screen.getAllByRole('button', { name: /Billing/i })[0]
    fireEvent.click(billingButton)

    fireEvent.click(screen.getByRole('button', { name: /CANCEL SUBSCRIPTION/i }))
    fireEvent.click(screen.getByRole('button', { name: /YES, CANCEL PLAN/i }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Subscription cancellation scheduled successfully.')
    })
    expect(cancelSubscriptionAction).toHaveBeenCalled()
  })
})
