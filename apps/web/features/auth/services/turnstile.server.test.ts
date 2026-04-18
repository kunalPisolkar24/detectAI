import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateTurnstileToken } from './turnstile.server'

vi.mock('@/lib/env', () => ({
  env: {
    TURNSTILE_SECRET_KEY: 'test-secret'
  }
}))

describe('validateTurnstileToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('should return true if turnstile verification succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    } as any)

    const result = await validateTurnstileToken('valid-token')

    expect(result).toBe(true)
    expect(fetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
      })
    )
  })

  it('should return false if turnstile verification fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: false, 'error-codes': ['invalid-input-response'] }),
    } as any)

    const result = await validateTurnstileToken('invalid-token')

    expect(result).toBe(false)
  })

  it('should return false if fetch throws an error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

    const result = await validateTurnstileToken('token')

    expect(result).toBe(false)
  })
})
