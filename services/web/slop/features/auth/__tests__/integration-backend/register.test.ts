import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerAction } from '../../actions/register'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import { prisma } from '@/lib/infrastructure/prisma'

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

    // Mock prisma responses
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'user-123',
      email: signupData.email,
      name: 'John Doe',
    } as any)

    const result = await registerAction(signupData, token)

    expect(result).toEqual({ success: true })
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: signupData.email,
          firstName: signupData.firstName,
        })
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
    expect(prisma.user.create).not.toHaveBeenCalled()
  })

  it('fails if email is already in use', async () => {
    const signupData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
    }

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing-123', email: 'john@example.com' } as any)

    const result = await registerAction(signupData, 'valid-token')

    expect(result).toEqual({ error: 'Email already in use' })
    expect(prisma.user.create).not.toHaveBeenCalled()
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
