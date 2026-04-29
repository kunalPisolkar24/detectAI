import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnalysisOrchestrator } from '../../services/analysis-orchestrator'
import { Message } from '../../types'

describe('AnalysisOrchestrator Integration', () => {
  const mockChatService = {
    saveUserMessage: vi.fn(),
    saveAssistantAnalysisMessage: vi.fn(),
  }

  const mockInferenceService = {
    streamDocument: vi.fn(),
  }

  const mockRateLimitService = {
    trackUsage: vi.fn(),
  }

  // @ts-ignore
  const orchestrator = new AnalysisOrchestrator(mockChatService, mockInferenceService, mockRateLimitService)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('orchestrates a successful analysis flow', async () => {
    const params = {
      chatId: 'chat-1',
      userId: 'user-1',
      content: 'Test content',
      model: 'spark' as const,
    }

    const userMessage: Message = {
      id: 'msg-1',
      role: 'user',
      content: params.content,
      createdAt: new Date(),
    }

    const assistantRunningMessage: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      state: 'running',
      model: 'spark',
    }

    const assistantCompletedMessage: Message = {
      ...assistantRunningMessage,
      state: 'completed',
      analysis: { score: 0.5, label: 'human' } as any,
    }

    mockChatService.saveUserMessage.mockResolvedValue(userMessage)
    mockChatService.saveAssistantAnalysisMessage
      .mockResolvedValueOnce(assistantRunningMessage)
      .mockResolvedValueOnce(assistantCompletedMessage)

    mockInferenceService.streamDocument.mockImplementation(async (_content, _model, { onEvent }) => {
      onEvent({ type: 'delta', content: 'analysing...' })
      onEvent({ type: 'final', result: { score: 0.5, label: 'human' } })
    })

    const stream = await orchestrator.execute(params, new AbortController().signal)
    const reader = stream.getReader()
    const results = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      results.push(JSON.parse(new TextDecoder().decode(value)))
    }

    expect(results).toHaveLength(3)
    expect(results[0].type).toBe('accepted')
    expect(results[1].type).toBe('delta')
    expect(results[2].type).toBe('final')
    
    expect(mockChatService.saveUserMessage).toHaveBeenCalledWith(params.chatId, params.userId, params.content)
    expect(mockRateLimitService.trackUsage).toHaveBeenCalledWith(params.userId)
  })

  it('handles analysis failure correctly', async () => {
    const params = {
      chatId: 'chat-1',
      userId: 'user-1',
      content: 'Test content',
      model: 'spark' as const,
    }

    const userMessage: Message = {
      id: 'msg-1',
      role: 'user',
      content: params.content,
      createdAt: new Date(),
    }

    const assistantRunningMessage: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: '',
      createdAt: new Date(),
      state: 'running',
      model: 'spark',
    }

    mockChatService.saveUserMessage.mockResolvedValue(userMessage)
    mockChatService.saveAssistantAnalysisMessage.mockResolvedValue(assistantRunningMessage)

    mockInferenceService.streamDocument.mockRejectedValue(new Error('AI Service Down'))

    const stream = await orchestrator.execute(params, new AbortController().signal)
    const reader = stream.getReader()
    const results = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      results.push(JSON.parse(new TextDecoder().decode(value)))
    }

    expect(results.some(r => r.type === 'error')).toBe(true)
    expect(mockChatService.saveAssistantAnalysisMessage).toHaveBeenCalledWith(
      params.chatId,
      params.userId,
      expect.objectContaining({ state: 'failed' })
    )
  })
})
