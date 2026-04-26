import { http, HttpResponse } from 'msw'

export const chatHandlers = [
  http.get('/api/chat/sessions', () => {
    return HttpResponse.json([])
  }),

  http.post('/api/chat/messages', async () => {
    return HttpResponse.json({
      id: 'msg-response',
      role: 'assistant',
      content: 'This is a mocked AI response',
      createdAt: new Date().toISOString()
    })
  })
]
