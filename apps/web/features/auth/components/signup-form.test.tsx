import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import { registerAction } from '@/features/auth/actions/register'
import { SignupForm } from './signup-form'

vi.mock('@/features/auth/actions/register', () => ({
  registerAction: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/features/auth/hooks/use-turnstile', () => ({
  useTurnstile: vi.fn(),
}))

vi.mock('@/features/auth/components/turnstile', () => ({
  TurnstileComponent: () => <div data-testid="mock-turnstile" />,
}))

vi.mock('@/lib/core/fonts', () => ({
  teko: { className: 'teko' },
  merriweather: { className: 'merriweather' },
}))

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockRefresh = vi.fn()
const mockReset = vi.fn()

const defaultTurnstile = {
  token: 'mock-turnstile-token',
  key: 0,
  siteKey: 'test-site-key',
  isConfigured: true,
  errorCode: null,
  errorMessage: null,
  onVerify: vi.fn(),
  onError: vi.fn(),
  onExpire: vi.fn(),
  onTimeout: vi.fn(),
  reset: mockReset,
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(useTurnstile).mockReturnValue({ ...defaultTurnstile, reset: mockReset })

  vi.mocked(useRouter).mockReturnValue({
    push: mockPush,
    replace: mockReplace,
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  } as any)

  vi.mocked(signIn).mockResolvedValue({ ok: true, error: null, status: 200, url: '/chat?login_success=true' } as any)
  vi.mocked(registerAction).mockResolvedValue({ success: true } as any)
})

describe('SignupForm', () => {
  describe('initial render', () => {
    it('renders all required fields', async () => {
      render(<SignupForm />)
      expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument()
      expect(await screen.findByLabelText(/last name/i)).toBeInTheDocument()
      expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument()
      expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument()
      expect(await screen.findByLabelText(/^confirm password$/i)).toBeInTheDocument()
    })

    it('renders the login link', async () => {
      render(<SignupForm />)
      expect(await screen.findByRole('link', { name: /already have an account/i })).toHaveAttribute('href', '/login')
    })

    it('renders social login buttons', async () => {
      render(<SignupForm />)
      expect(await screen.findByRole('button', { name: /google/i })).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /github/i })).toBeInTheDocument()
    })

    it('renders Turnstile component when configured', async () => {
      render(<SignupForm />)
      expect(await screen.findByTestId('mock-turnstile')).toBeInTheDocument()
    })

    it('has no basic accessibility violations', async () => {
      const { container } = render(<SignupForm />)
      await screen.findByLabelText(/first name/i)
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })
  })

  describe('user interactions', () => {
    it('toggles password and confirm password visibility independently', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<SignupForm />)
      
      const passwordInput = await screen.findByLabelText(/^password$/i)
      const confirmInput = await screen.findByLabelText(/^confirm password$/i)
      
      const togglePassword = await screen.findByLabelText(/^show password$/i)
      const toggleConfirm = await screen.findByLabelText(/^show confirm password$/i)

      expect(passwordInput).toHaveAttribute('type', 'password')
      expect(confirmInput).toHaveAttribute('type', 'password')

      await user.click(togglePassword)
      expect(passwordInput).toHaveAttribute('type', 'text')
      expect(confirmInput).toHaveAttribute('type', 'password')

      await user.click(toggleConfirm)
      expect(passwordInput).toHaveAttribute('type', 'text')
      expect(confirmInput).toHaveAttribute('type', 'text')
    })
  })

  describe.skip('form submission', () => {
    // Skipping async submission tests as per plan for now
    it('calls registerAction and signIn on valid submission', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<SignupForm />)
      
      await user.type(await screen.findByLabelText(/first name/i), 'John')
      await user.type(await screen.findByLabelText(/last name/i), 'Doe')
      await user.type(await screen.findByLabelText(/^email$/i), 'john@example.com')
      await user.type(await screen.findByLabelText(/^password$/i), 'password123')
      await user.type(await screen.findByLabelText(/confirm password/i), 'password123')
      
      const submitButton = await screen.findByRole('button', { name: /create account/i })
      await user.click(submitButton)

      await waitFor(() => {
        expect(registerAction).toHaveBeenCalled()
        expect(signIn).toHaveBeenCalled()
      })
    })
  })
})
