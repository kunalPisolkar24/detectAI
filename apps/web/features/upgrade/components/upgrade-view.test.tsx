import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { UpgradeView } from './upgrade-view'
import { useSession } from 'next-auth/react'
import { initializePaddle } from '@paddle/paddle-js'
import { useRouter } from 'next/navigation'

vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: vi.fn(),
}))

vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return {
    ...actual,
    useSession: vi.fn(),
  }
})

describe('UpgradeView', () => {
  const mockPush = vi.fn()
  const mockBack = vi.fn()
  const mockUpdate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      back: mockBack,
    } as any)
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1', email: 'test@example.com', isPremium: false } },
      status: 'authenticated',
      update: mockUpdate,
    } as any)
    vi.mocked(initializePaddle).mockResolvedValue({
      Checkout: { open: vi.fn() },
    } as any)
  })

  it('renders correctly and handles back button', async () => {
    render(<UpgradeView />)
    expect(await screen.findByRole('heading', { name: /Choose The Plan/i })).toBeInTheDocument()

    const backButton = screen.getByText(/back/i)
    fireEvent.click(backButton)
    expect(mockBack).toHaveBeenCalled()
  })

  it('handles plan selection and opens Paddle checkout', async () => {
    const mockCheckoutOpen = vi.fn()
    vi.mocked(initializePaddle).mockResolvedValue({
      Checkout: { open: mockCheckoutOpen },
    } as any)

    render(<UpgradeView />)

    await waitFor(() => {
      expect(initializePaddle).toHaveBeenCalled()
    })

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now/i })
    fireEvent.click(upgradeButton)

    expect(mockCheckoutOpen).toHaveBeenCalledWith(expect.objectContaining({
      customer: { email: 'test@example.com' },
    }))
  })

  it('redirects to login if not authenticated', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: null, status: 'unauthenticated', update: mockUpdate,
    } as any)

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now/i })
    fireEvent.click(upgradeButton)

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/login'))
  })
})
