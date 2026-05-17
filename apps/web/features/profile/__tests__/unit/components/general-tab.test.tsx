import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { GeneralTab } from '../../../components/general-tab'
import { useSession } from 'next-auth/react'
import { updateProfileAction } from '../../../actions/update-profile'
import { toast } from 'sonner'

vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return {
    ...actual,
    useSession: vi.fn(),
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../../actions/update-profile', () => ({
  updateProfileAction: vi.fn(),
}))

vi.mock('@/lib/core/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
  inter: { className: 'inter' },
}))

// Mock UsageStats to simplify
vi.mock('../../../components/usage-stats', () => ({
  UsageStats: () => <div data-testid="usage-stats" />
}))

describe('GeneralTab', () => {
  const mockUpdate = vi.fn()
  const mockUser = {
    id: 'user-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    image: null,
    createdAt: new Date('2024-01-01'),
    isPremium: false,
    apiCallCountDaily: 10,
    apiCallCountTotal: 100,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: { user: mockUser },
      status: 'authenticated',
      update: mockUpdate,
    } as any)
  })

  it('renders user information correctly', () => {
    render(<GeneralTab user={mockUser} />)
    
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
    expect(screen.getByText('January 1, 2024')).toBeInTheDocument()
    expect(screen.getByTestId('usage-stats')).toBeInTheDocument()
  })

  it('toggles edit mode', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(<GeneralTab user={mockUser} />)
    
    await user.click(screen.getByRole('button', { name: /Edit Profile/i }))
    
    expect(screen.getByLabelText(/First Name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Last Name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /SAVE/i })).toBeInTheDocument()
    
    await user.click(screen.getByRole('button', { name: /CANCEL/i }))
    expect(screen.queryByLabelText(/First Name/i)).not.toBeInTheDocument()
  })

  it(
    "shows validation errors for empty fields",
    async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<GeneralTab user={mockUser} />)

      await user.click(screen.getByRole("button", { name: /Edit Profile/i }))

      const firstNameInput = screen.getByLabelText(/First Name/i)
      const lastNameInput = screen.getByLabelText(/Last Name/i)

      await user.clear(firstNameInput)
      await user.clear(lastNameInput)
      
      const form = firstNameInput.closest('form')
      if (form) fireEvent.submit(form)

      expect(await screen.findByText(/First name is required/i)).toBeInTheDocument()
      expect(await screen.findByText(/Last name is required/i)).toBeInTheDocument()
    }
  )

  it(
    "handles successful profile update",
    async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(updateProfileAction).mockResolvedValue({ error: null } as any)

      render(<GeneralTab user={mockUser} />)

      await user.click(screen.getByRole("button", { name: /Edit Profile/i }))

      const firstNameInput = screen.getByLabelText(/First Name/i)
      await user.clear(firstNameInput)
      await user.type(firstNameInput, "Jane")

      const form = firstNameInput.closest('form')
      if (form) fireEvent.submit(form)

      await waitFor(
        () => {
          expect(updateProfileAction).toHaveBeenCalled()
          expect(mockUpdate).toHaveBeenCalled()
          expect(toast.success).toHaveBeenCalledWith("Profile updated successfully")
        }
      )

      expect(screen.queryByLabelText(/First Name/i)).not.toBeInTheDocument()
    }
  )

  it(
    "shows error toast if update fails",
    async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(updateProfileAction).mockResolvedValue({ error: "Update failed" } as any)

      render(<GeneralTab user={mockUser} />)

      await user.click(screen.getByRole("button", { name: /Edit Profile/i }))
      
      const firstNameInput = screen.getByLabelText(/First Name/i)
      await user.type(firstNameInput, " - edited")

      const form = firstNameInput.closest('form')
      if (form) fireEvent.submit(form)

      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith("Update failed")
        }
      )
    }
  )
})
