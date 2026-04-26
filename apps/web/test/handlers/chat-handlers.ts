import { http, HttpResponse } from 'msw'

const createFinalMessage = () => ({
  id: 'msg-assistant',
  role: 'assistant',
  content: '',
  createdAt: new Date().toISOString(),
  analysis: {
    model: 'spark',
    label: 'AI',
    confidence: 0.92,
    scores: { ai: 0.92, human: 0.08 },
    highlights: [],
    raw: {},
  },
})

export const chatHandlers = [
  http.get('/api/chat/sessions', () => {
    return HttpResponse.json([])
  }),

  http.post('/api/chat/sessions', async () => {
    return HttpResponse.json({
      success: true,
      data: {
        id: 'chat-123',
        title: 'New Chat',
        updatedAt: new Date().toISOString(),
      },
    })
  }),

  http.post('/api/chat/analyze/stream', async () => {
    const finalMsg = createFinalMessage()
    const events = [
      { type: 'accepted', message: { id: 'msg-assistant', role: 'assistant', content: '', createdAt: new Date().toISOString() } },
      { type: 'started', totalChars: 100, totalChunks: 2 },
      { type: 'progress', processedChunks: 1, totalChunks: 2 },
      { type: 'progress', processedChunks: 2, totalChunks: 2 },
      { type: 'final', message: finalMsg },
    ]

    const body = events.map(e => JSON.stringify(e)).join('\n') + '\n'

    return new HttpResponse(body, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }),

  http.get('/api/chat/history', () => {
    return HttpResponse.json([])
  }),
]
