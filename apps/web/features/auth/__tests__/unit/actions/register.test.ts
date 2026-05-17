import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAction } from '../../../actions/register'
import { userService } from '@/features/auth/services/user-service'
import { validateTurnstileToken } from '@/features/auth/services/turnstile.server'
import bcrypt from 'bcryptjs'

vi.mock('@/features/auth/services/user-service', () => ({
  userService: {
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
  },
}))

vi.mock('@/features/auth/services/turnstile.server', () => ({
  validateTurnstileToken: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
  },
}))

describe('registerAction', () => {
  const mockValues = {
    email: 'test@example.com',
    password: 'password123',
    confirmPassword: 'password123',
    firstName: 'John',
    lastName: 'Doe',
  }
  const mockToken = 'mock-token'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error if validation fails', async () => {
    const invalidValues = { ...mockValues, email: 'invalid-email' }
    const result = await registerAction(invalidValues as any, mockToken)
    expect(result).toEqual({ error: 'Invalid input fields' })
  })

  it('returns error if turnstile token is missing', async () => {
    const result = await registerAction(mockValues, null)
    expect(result).toEqual({ error: 'Please complete the captcha verification' })
  })

  it('returns error if turnstile verification fails', async () => {
    vi.mocked(validateTurnstileToken).mockResolvedValue(false)
    const result = await registerAction(mockValues, mockToken)
    expect(result).toEqual({ error: 'Security check failed. Please try again.' })
  })

  it('returns error if user already exists', async () => {
    vi.mocked(validateTurnstileToken).mockResolvedValue(true)
    vi.mocked(userService.getUserByEmail).mockResolvedValue({ id: '1' } as any)
    const result = await registerAction(mockValues, mockToken)
    expect(result).toEqual({ error: 'Email already in use' })
  })

  it('creates user and returns success if all checks pass', async () => {
    vi.mocked(validateTurnstileToken).mockResolvedValue(true)
    vi.mocked(userService.getUserByEmail).mockResolvedValue(null)
    vi.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never)
    vi.mocked(userService.createUser).mockResolvedValue({ id: '2' } as any)

    const result = await registerAction(mockValues, mockToken)

    expect(userService.createUser).toHaveBeenCalledWith({
      name: 'John Doe',
      email: 'test@example.com',
      password: 'hashed-password',
      firstName: 'John',
      lastName: 'Doe',
    })
    expect(result).toEqual({ success: true })
  })

  it('returns generic error if an exception occurs', async () => {
    vi.mocked(validateTurnstileToken).mockRejectedValue(new Error('Network error'))
    const result = await registerAction(mockValues, mockToken)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
  })
})
