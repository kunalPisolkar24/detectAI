import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAction } from '../../actions/register'
import { userService } from '@/features/auth/services/user-service'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'

vi.mock('@/features/auth/services/user-service', () => ({
  userService: {
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
  },
}))

describe('registerAction Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    server.use(
      http.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', () => {
        return HttpResponse.json({ success: true })
      })
    )
  })

  it('successfully registers a new user with valid input and token', async () => {
    const signupData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }
    const token = 'valid-token'

    vi.mocked(userService.getUserByEmail).mockResolvedValue(null)
    vi.mocked(userService.createUser).mockResolvedValue({
      id: 'user-123',
      email: signupData.email,
      name: 'John Doe',
    } as any)

    const result = await registerAction(signupData, token)

    expect(result).toEqual({ success: true })
    expect(userService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: signupData.email,
        firstName: signupData.firstName,
      })
    )
  })

  it('fails if turnstile verification fails', async () => {
    server.use(
      http.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', () => {
        return HttpResponse.json({ success: false })
      })
    )

    const signupData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }

    const result = await registerAction(signupData, 'invalid-token')

    expect(result).toEqual({ error: 'Security check failed. Please try again.' })
    expect(userService.createUser).not.toHaveBeenCalled()
  })

  it('fails if email is already in use', async () => {
    const signupData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }

    vi.mocked(userService.getUserByEmail).mockResolvedValue({ id: 'existing-123' } as any)

    const result = await registerAction(signupData, 'valid-token')

    expect(result).toEqual({ error: 'Email already in use' })
    expect(userService.createUser).not.toHaveBeenCalled()
  })

  it('fails if input validation fails', async () => {
    const invalidData = {
      firstName: '',
      lastName: 'Doe',
      email: 'invalid-email',
      password: '123',
      confirmPassword: '456',
    }

    const result = await registerAction(invalidData as any, 'valid-token')

    expect(result).toEqual({ error: 'Invalid input fields' })
  })
})
