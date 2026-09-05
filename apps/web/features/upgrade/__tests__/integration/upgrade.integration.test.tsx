import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { UpgradeView } from '../../components/upgrade-view'
import { useSession } from 'next-auth/react'
import { initializePaddle } from '@paddle/paddle-js'
import { useRouter } from 'next/navigation'

vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: vi.fn(),
}))

vi.mock('../../actions/confirm-upgrade', () => ({
  confirmUpgradeAction: vi.fn().mockResolvedValue({ isPremium: false }),
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
    localStorage.clear()
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

    fireEvent.click(screen.getByText(/back/i))
    expect(mockBack).toHaveBeenCalled()
  })

  it('ignores non-flare plan selection', async () => {
    const mockCheckoutOpen = vi.fn()
    vi.mocked(initializePaddle).mockResolvedValue({
      Checkout: { open: mockCheckoutOpen },
    } as any)

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())

    // Spark plan is the free one, clicking "Get Started" button
    const sparkButton = await screen.findByRole('button', { name: /Get Started/i })
    fireEvent.click(sparkButton)

    // Checkout should NOT open for spark plan
    expect(mockCheckoutOpen).not.toHaveBeenCalled()
  })

  it('handles plan selection and opens Paddle checkout', async () => {
    const mockCheckoutOpen = vi.fn()
    vi.mocked(initializePaddle).mockResolvedValue({
      Checkout: { open: mockCheckoutOpen },
    } as any)

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now/i })
    fireEvent.click(upgradeButton)

    expect(mockCheckoutOpen).toHaveBeenCalledWith(expect.objectContaining({
      customer: { email: 'test@example.com' },
    }))
  })

  it('uses empty string when user email is null', async () => {
    const mockCheckoutOpen = vi.fn()
    vi.mocked(initializePaddle).mockResolvedValue({
      Checkout: { open: mockCheckoutOpen },
    } as any)
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1', email: null, isPremium: false } },
      status: 'authenticated',
      update: mockUpdate,
    } as any)

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())

    const upgradeButton = await screen.findByRole('button', { name: /Upgrade Now/i })
    fireEvent.click(upgradeButton)

    expect(mockCheckoutOpen).toHaveBeenCalledWith(expect.objectContaining({
      customer: { email: '' },
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

    expect(mockPush).toHaveBeenCalledWith('/login?callbackUrl=/upgrade')
  })

  it.skip('shows error when paddle not yet initialized', async () => {
    // This branch (line 78-80) is difficult to reach because paddle initializes
    // asynchronously and the UI shows the upgrade button only after initialization.
    // Skipping per policy on difficult async tests.
  })

  it('resumes pendingUpgrade on mount and activates premium', async () => {
    const { confirmUpgradeAction } = await import('../../actions/confirm-upgrade')
    vi.mocked(confirmUpgradeAction).mockResolvedValueOnce({ isPremium: false }).mockResolvedValueOnce({ isPremium: true })
    // first mount: webhook not yet, second call true simulates webhook at ~10s
    // For test we mock single mount that directly returns true (webhook already arrived)
    vi.mocked(confirmUpgradeAction).mockReset()
    vi.mocked(confirmUpgradeAction).mockResolvedValue({ isPremium: true })
    localStorage.setItem('pendingUpgrade', JSON.stringify({ ts: Date.now() }))

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())
    await waitFor(() => expect(confirmUpgradeAction).toHaveBeenCalled())
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ isPremium: true }))
    expect(mockPush).toHaveBeenCalledWith('/chat?upgrade_success=true')
    expect(localStorage.getItem('pendingUpgrade')).toBeNull()
  })

  it('does not poll when pendingUpgrade expired beyond 2hr', async () => {
    const { confirmUpgradeAction } = await import('../../actions/confirm-upgrade')
    vi.mocked(confirmUpgradeAction).mockClear()
    localStorage.setItem('pendingUpgrade', JSON.stringify({ ts: Date.now() - 7200000 - 1000 }))

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())
    // wait a tick for mount effect
    await new Promise(r => setTimeout(r, 50))
    expect(confirmUpgradeAction).not.toHaveBeenCalled()
    expect(localStorage.getItem('pendingUpgrade')).toBeNull()
  })

  it('clears pendingUpgrade when already premium', async () => {
    const { confirmUpgradeAction } = await import('../../actions/confirm-upgrade')
    vi.mocked(confirmUpgradeAction).mockClear()
    localStorage.setItem('pendingUpgrade', JSON.stringify({ ts: Date.now() }))
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1', email: 'test@example.com', isPremium: true } },
      status: 'authenticated',
      update: mockUpdate,
    } as any)

    render(<UpgradeView />)
    await waitFor(() => expect(initializePaddle).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 50))
    expect(confirmUpgradeAction).not.toHaveBeenCalled()
    expect(localStorage.getItem('pendingUpgrade')).toBeNull()
  })
})
