import { describe, it, expect, vi, beforeEach } from 'vitest'

const nextAuthHandler = vi.fn()

vi.mock('next-auth', () => ({
  default: vi.fn(() => nextAuthHandler),
}))

vi.mock('@/lib/config/auth-options', () => ({
  authOptions: {},
}))

const { POST } = await import('@/app/api/auth/[...nextauth]/route')

const context = { params: Promise.resolve({ nextauth: ['callback', 'credentials'] }) }

describe('NextAuth route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextAuthHandler.mockResolvedValue(new Response('ok'))
  })

  it('refuses a malformed body with 400 instead of letting it become a server error', async () => {
    const request = new Request('http://localhost/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await POST(request as any, context as any)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' })
    expect(nextAuthHandler).not.toHaveBeenCalled()
  })

  it('hands a well formed body to NextAuth', async () => {
    const request = new Request('http://localhost/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
    })

    const response = await POST(request as any, context as any)

    expect(response.status).toBe(200)
    expect(nextAuthHandler).toHaveBeenCalledTimes(1)
  })

  it('leaves a form encoded body to NextAuth', async () => {
    const request = new Request('http://localhost/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=user%40example.com&password=secret',
    })

    const response = await POST(request as any, context as any)

    expect(response.status).toBe(200)
    expect(nextAuthHandler).toHaveBeenCalledTimes(1)
  })
})
