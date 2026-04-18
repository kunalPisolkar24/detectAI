import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import { verifyTurnstileAction } from '@/features/auth/actions/verify-turnstile'
import { LoginForm } from './login-form'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'

vi.mock('@/features/auth/actions/verify-turnstile', () => ({
  verifyTurnstileAction: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/features/auth/hooks/use-turnstile', () => ({
  useTurnstile: vi.fn(),
}))

vi.mock('@/features/auth/components/turnstile', () => ({
  TurnstileComponent: () => <div data-testid="mock-turnstile" />,
}))

vi.mock('@/lib/fonts', () => ({
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

  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as any)
  vi.mocked(signIn).mockResolvedValue({ ok: true, error: null, status: 200, url: '/chat?login_success=true' } as any)
  vi.mocked(verifyTurnstileAction).mockResolvedValue({ success: true })
})

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useTransition: () => [false, (fn: () => void) => fn()],
  }
})

const fillAndSubmitLoginForm = async (user: ReturnType<typeof userEvent.setup>, email: string, pass: string) => {
  const emailInput = await screen.findByLabelText(/^email$/i)
  const passwordInput = await screen.findByLabelText(/^password$/i)
  const submitButton = await screen.findByRole('button', { name: /sign in/i })

  await user.type(emailInput, email)
  await user.type(passwordInput, pass)
  await user.click(submitButton)
  await new Promise(r => setTimeout(r, 0))
}

describe('LoginForm', () => {
  describe('initial render', () => {
    it('renders the email and password fields', async () => {
      render(<LoginForm />)
      expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument()
      expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument()
    })

    it('renders the remember me checkbox', async () => {
      render(<LoginForm />)
      expect(await screen.findByLabelText(/remember me/i)).toBeInTheDocument()
    })

    it('renders the forgot password link', async () => {
      render(<LoginForm />)
      expect(await screen.findByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
    })

    it('renders the sign up link', async () => {
      render(<LoginForm />)
      expect(await screen.findByRole('link', { name: /don't have an account/i })).toHaveAttribute('href', '/signup')
    })

    it('renders social login buttons', async () => {
      render(<LoginForm />)
      expect(await screen.findByRole('button', { name: /google/i })).toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /github/i })).toBeInTheDocument()
    })

    it('renders Turnstile component when configured', async () => {
      render(<LoginForm />)
      expect(await screen.findByTestId('mock-turnstile')).toBeInTheDocument()
    })

    it('shows error message when Turnstile is not configured', async () => {
      vi.mocked(useTurnstile).mockReturnValue({
        ...defaultTurnstile,
        token: null,
        siteKey: '',
        isConfigured: false,
        errorMessage: 'Turnstile is not configured',
      })
      render(<LoginForm />)
      expect(await screen.findByText(/turnstile is not configured/i)).toBeInTheDocument()
    })

    it('submit button is disabled when turnstile token is absent', async () => {
      vi.mocked(useTurnstile).mockReturnValue({
        ...defaultTurnstile,
        token: null,
      })
      render(<LoginForm />)
      expect(await screen.findByRole('button', { name: /sign in/i })).toBeDisabled()
    })

    it('has no basic accessibility violations', async () => {
      const { container } = render(<LoginForm />)
      await screen.findByLabelText(/^email$/i)
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })
  })

  describe('user interactions', () => {
    it('toggles password visibility', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<LoginForm />)
      const passwordInput = await screen.findByLabelText(/^password$/i)

      expect(passwordInput).toHaveAttribute('type', 'password')
      await user.click(await screen.findByLabelText(/show password/i))
      expect(passwordInput).toHaveAttribute('type', 'text')
      await user.click(await screen.findByLabelText(/hide password/i))
      expect(passwordInput).toHaveAttribute('type', 'password')
    })

    it('updates remember me checkbox state', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<LoginForm />)
      const checkbox = await screen.findByRole('checkbox', { name: /remember me/i })

      expect(checkbox).not.toBeChecked()
      await user.click(checkbox)
      expect(checkbox).toBeChecked()
    })
  })

  describe.skip('happy path submission', () => {
    it('calls signIn with correct credentials on valid form submission', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<LoginForm />)
      await fillAndSubmitLoginForm(user, 'user@test.com', 'password123')
      await waitFor(() => {
        expect(signIn).toHaveBeenCalledWith('credentials', expect.objectContaining({
          email: 'user@test.com',
          password: 'password123',
          redirect: false,
        }))
      }, { timeout: 3000 })
    })

    it('navigates to chat on successful sign-in', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      render(<LoginForm />)
      await fillAndSubmitLoginForm(user, 'user@test.com', 'password123')
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/chat?login_success=true')
      })
    })

    it('saves email to localStorage if remember me is checked', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      render(<LoginForm />)

      await user.click(await screen.findByRole('checkbox', { name: /remember me/i }))
      await fillAndSubmitLoginForm(user, 'user@test.com', 'password123')

      await waitFor(() => {
        expect(setItemSpy).toHaveBeenCalledWith('rememberEmail', 'user@test.com')
      })
    })
  })

  describe.skip('error edge cases', () => {
    it('shows error when signIn fails', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(signIn).mockResolvedValueOnce({ error: 'CredentialsSignin', ok: false, status: 401, url: null })
      render(<LoginForm />)

      await fillAndSubmitLoginForm(user, 'user@test.com', 'wrongpassword')
      expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument()
    })

    it('shows generic error when signIn throws', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(signIn).mockRejectedValueOnce(new Error('Network error'))
      render(<LoginForm />)

      await fillAndSubmitLoginForm(user, 'user@test.com', 'password123')
      expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    })

    it('shows verification failed when Turnstile server verification fails', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(verifyTurnstileAction).mockResolvedValueOnce({ success: false, error: 'Verification failed' })
      render(<LoginForm />)

      await fillAndSubmitLoginForm(user, 'user@test.com', 'password123')
      expect(await screen.findByText(/verification failed/i)).toBeInTheDocument()
    })

    it('shows an error when the MSW Turnstile endpoint returns a failure', async () => {
      server.use(
        http.post('/api/auth/verify-turnstile', () => {
          return HttpResponse.json({ success: false }, { status: 400 })
        })
      )
      const user = userEvent.setup({ pointerEventsCheck: 0 })
      vi.mocked(verifyTurnstileAction).mockResolvedValueOnce({ success: false, error: 'Verification failed' })
      render(<LoginForm />)
      await fillAndSubmitLoginForm(user, 'user@test.com', 'password123')
      expect(await screen.findByText(/verification failed/i)).toBeInTheDocument()
    })
  })
})
