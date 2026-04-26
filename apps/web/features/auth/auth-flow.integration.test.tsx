import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { LoginForm } from './components/login-form'
import { render } from '@/test/custom-renderer'
import { signIn } from 'next-auth/react'
import { verifyTurnstileAction } from './actions/verify-turnstile'

vi.mock('./actions/verify-turnstile', () => ({
  verifyTurnstileAction: vi.fn(),
}))

vi.mock('./hooks/use-turnstile', () => ({
  useTurnstile: () => ({
    token: 'test-token',
    key: 0,
    siteKey: 'test-site-key',
    isConfigured: true,
    errorMessage: null,
    onVerify: vi.fn(),
    onError: vi.fn(),
    onExpire: vi.fn(),
    onTimeout: vi.fn(),
    reset: vi.fn(),
  }),
}))

describe('Auth Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes successful login flow', async () => {
    vi.mocked(verifyTurnstileAction).mockResolvedValue({ success: true })
    vi.mocked(signIn).mockResolvedValue({ error: null, ok: true, status: 200, url: '' })

    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: 'test@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password123' },
    })

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(verifyTurnstileAction).toHaveBeenCalledWith('test-token')
      expect(signIn).toHaveBeenCalledWith('credentials', expect.any(Object))
    })
  })

  it('shows error message on failed verification', async () => {
    vi.mocked(verifyTurnstileAction).mockResolvedValue({
      success: false,
      error: 'Verification failed',
    })

    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: 'test@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password123' },
    })

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/verification failed/i)).toBeInTheDocument()
    })
  })
})
