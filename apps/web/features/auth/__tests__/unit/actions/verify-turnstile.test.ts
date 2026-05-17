import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyTurnstileAction } from '../../../actions/verify-turnstile'
import { validateTurnstileToken } from '@/features/auth/services/turnstile.server'

vi.mock('@/features/auth/services/turnstile.server', () => ({
  validateTurnstileToken: vi.fn(),
}))

describe('verifyTurnstileAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error if token is missing', async () => {
    const result = await verifyTurnstileAction('')
    expect(result).toEqual({ success: false, error: 'Token is missing' })
  })

  it('returns error if turnstile verification fails', async () => {
    vi.mocked(validateTurnstileToken).mockResolvedValue(false)
    const result = await verifyTurnstileAction('mock-token')
    expect(result).toEqual({ success: false, error: 'Invalid captcha' })
  })

  it('returns success if turnstile verification passes', async () => {
    vi.mocked(validateTurnstileToken).mockResolvedValue(true)
    const result = await verifyTurnstileAction('mock-token')
    expect(result).toEqual({ success: true })
  })
})
