import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../../../../app/api/chat/analyze/stream/route'
import { getServerSession } from 'next-auth'
import { analysisOrchestrator } from '@/features/chat/services/analysis-orchestrator'
import { rateLimitService } from '@/features/rate-limit/services/rate-limit-service'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/features/chat/services/analysis-orchestrator', () => ({
  analysisOrchestrator: {
    execute: vi.fn(),
  },
}))

vi.mock('@/features/rate-limit/services/rate-limit-service', () => ({
  rateLimitService: {
    checkLimit: vi.fn(),
  },
}))

describe('Chat Analyze Stream API Route Integration', () => {
  const mockUserId = 'user-123'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: mockUserId, isPremium: false } } as any)
    vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: true, remaining: 50 })
  })

  it('returns 401 if unauthorized', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const request = new Request('http://localhost/api/chat/analyze/stream', {
      method: 'POST',
      body: JSON.stringify({ chatId: 'c1', content: 'test', model: 'spark' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('returns 429 if rate limited', async () => {
    vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: false, remaining: 0 })
    const request = new Request('http://localhost/api/chat/analyze/stream', {
      method: 'POST',
      body: JSON.stringify({ chatId: 'c1', content: 'test', model: 'spark' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(429)
  })

  it('successfully starts stream and returns 200', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'delta', content: 'hello' })))
        controller.close()
      }
    })
    vi.mocked(analysisOrchestrator.execute).mockResolvedValue(mockStream as any)

    const request = new Request('http://localhost/api/chat/analyze/stream', {
      method: 'POST',
      body: JSON.stringify({ chatId: 'c1', content: 'test', model: 'spark' }),
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/x-ndjson; charset=utf-8')
    
    const reader = response.body?.getReader()
    const { value } = await reader!.read()
    const decoded = new TextDecoder().decode(value)
    expect(JSON.parse(decoded)).toEqual({ type: 'delta', content: 'hello' })
  })
})
