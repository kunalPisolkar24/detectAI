import { http, HttpResponse } from 'msw'

export const authHandlers = [
  http.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', () => {
    return HttpResponse.json({ success: true })
  }),

  http.post('/api/auth/callback/credentials', () => {
    return HttpResponse.json({ url: '/chat?login_success=true' })
  }),
  
  http.get('/api/auth/session', () => {
    return HttpResponse.json({})
  })
]
