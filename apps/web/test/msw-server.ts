import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', () =>
    HttpResponse.json({ success: true }),
  ),

  http.post('/api/auth/callback/credentials', () =>
    HttpResponse.json({ url: '/chat?login_success=true' }),
  ),
]

export const server = setupServer(...handlers)
