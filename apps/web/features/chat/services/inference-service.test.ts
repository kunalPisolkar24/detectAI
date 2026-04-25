import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inferenceService, InferenceStreamAbortedError } from './inference-service'
import { getGrpcClient, getGrpcMetadata } from '@/lib/infrastructure/grpc-client'
import { metrics } from '@/lib/infrastructure/metrics'
import { logger } from '@/lib/infrastructure/logger'

vi.mock('@/lib/infrastructure/grpc-client')
vi.mock('@/lib/infrastructure/metrics', () => ({ metrics: { aiInferenceDuration: { observe: vi.fn() } } }))
vi.mock('@/lib/infrastructure/logger', () => ({ logger: { error: vi.fn() } }))

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns a mock gRPC streaming call with .on() and .cancel() */
function makeMockCall() {
  return { on: vi.fn(), cancel: vi.fn() }
}

/**
 * Extracts a registered event handler by name from a mock streaming call.
 * Throws clearly if the handler was never registered, preventing silent failures.
 */
function getHandler(mockCall: ReturnType<typeof makeMockCall>, event: string) {
  const registration = mockCall.on.mock.calls.find((c: any) => c[0] === event)
  if (!registration) throw new Error(`Handler for "${event}" was never registered`)
  return registration[1] as (...args: any[]) => void
}

const MOCK_PROTO_RESPONSE = {
  model_name: 'spark',
  label: 'AI',
  is_ai_generated: true,
  confidence_score: 95,
  human_confidence: 5,
  ai_confidence: 95,
  highlight_spans: [{ char_start: 0, char_end: 5, ai_confidence: 90 }],
}

describe('inferenceService', () => {
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = { Detect: vi.fn(), AnalyzeDocument: vi.fn() }
    vi.mocked(getGrpcClient).mockReturnValue(mockClient)
    vi.mocked(getGrpcMetadata).mockReturnValue({} as any)
  })

  // ─── detect ────────────────────────────────────────────────────────────────
  describe('detect', () => {
    it('maps a successful gRPC response to the AnalysisResult domain model', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => {
        cb(null, MOCK_PROTO_RESPONSE)
      })

      const result = await inferenceService.detect('some text', 'spark')

      expect(result.label).toBe('AI')
      expect(result.confidence).toBeCloseTo(0.95)
      expect(result.scores.ai).toBeCloseTo(0.95)
      expect(result.scores.human).toBeCloseTo(0.05)
      expect(result.highlights).toHaveLength(1)
      expect(result.highlights[0]).toEqual({
        charStart: 0,
        charEnd: 5,
        aiConfidence: 0.9,
        label: 'AI', // ai_confidence 90 → 0.9 → >= 0.5 → 'AI'
      })
    })

    it('correctly labels a highlight span as "Human" when ai_confidence < 50', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => {
        cb(null, {
          ...MOCK_PROTO_RESPONSE,
          highlight_spans: [{ char_start: 0, char_end: 5, ai_confidence: 30 }],
        })
      })

      const result = await inferenceService.detect('text', 'spark')

      expect(result.highlights[0].label).toBe('Human')
    })

    it('returns an empty highlights array when the response has none', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => {
        cb(null, { ...MOCK_PROTO_RESPONSE, highlight_spans: undefined })
      })

      const result = await inferenceService.detect('text', 'spark')

      expect(result.highlights).toEqual([])
    })

    it('records a success metric on a successful inference', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => cb(null, MOCK_PROTO_RESPONSE))

      await inferenceService.detect('text', 'spark')

      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'success' },
        expect.any(Number),
      )
    })

    it('throws a user-facing error message when gRPC fails', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => cb(new Error('connection reset')))

      await expect(inferenceService.detect('text', 'spark')).rejects.toThrow(
        'AI Analysis Service Unavailable',
      )
    })

    it('records an error metric and logs on gRPC failure', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => cb(new Error('timeout')))

      await inferenceService.detect('text', 'spark').catch(() => {})

      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'error' },
        expect.any(Number),
      )
      expect(logger.error).toHaveBeenCalled()
    })
  })

  // ─── streamDocument ────────────────────────────────────────────────────────
  describe('streamDocument', () => {
    it('emits started → progress → final events in order', async () => {
      const mockCall = makeMockCall()
      mockClient.AnalyzeDocument.mockReturnValue(mockCall)
      const onEvent = vi.fn()

      const promise = inferenceService.streamDocument('text', 'spark', { onEvent })
      const dataHandler = getHandler(mockCall, 'data')
      const endHandler = getHandler(mockCall, 'end')

      dataHandler({ event: 'started', started: { total_chars: 200, total_chunks: 20 } })
      dataHandler({ event: 'progress', progress: { processed_chunks: 5, total_chunks: 20 } })
      dataHandler({ event: 'final', final: MOCK_PROTO_RESPONSE })
      endHandler()

      await promise

      expect(onEvent).toHaveBeenNthCalledWith(1, { type: 'started', totalChars: 200, totalChunks: 20 })
      expect(onEvent).toHaveBeenNthCalledWith(2, { type: 'progress', processedChunks: 5, totalChunks: 20 })
      expect(onEvent).toHaveBeenNthCalledWith(3, { type: 'final', result: expect.objectContaining({ label: 'AI' }) })
      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'success' },
        expect.any(Number),
      )
    })

    it('rejects with InferenceStreamAbortedError when signal is aborted before stream starts', async () => {
      const mockCall = makeMockCall()
      mockClient.AnalyzeDocument.mockReturnValue(mockCall)
      const controller = new AbortController()
      controller.abort() // pre-abort

      const onEvent = vi.fn()
      const promise = inferenceService.streamDocument('text', 'spark', {
        onEvent,
        signal: controller.signal,
      })

      await expect(promise).rejects.toBeInstanceOf(InferenceStreamAbortedError)
      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'cancelled' },
        expect.any(Number),
      )
      // onEvent must never fire if the signal was already aborted
      expect(onEvent).not.toHaveBeenCalled()
    })

    it('calls call.cancel() and rejects with InferenceStreamAbortedError when aborted mid-stream', async () => {
      const mockCall = makeMockCall()
      mockClient.AnalyzeDocument.mockReturnValue(mockCall)
      const controller = new AbortController()
      const onEvent = vi.fn()

      const promise = inferenceService.streamDocument('text', 'spark', {
        onEvent,
        signal: controller.signal,
      })

      const dataHandler = getHandler(mockCall, 'data')
      dataHandler({ event: 'started', started: { total_chars: 100, total_chunks: 10 } })

      // Abort mid-stream — simulates the user clicking "Cancel"
      controller.abort()

      // The gRPC stream will emit an error with code 1 (CANCELLED) after call.cancel()
      const errorHandler = getHandler(mockCall, 'error')
      errorHandler({ code: 1 })

      await expect(promise).rejects.toBeInstanceOf(InferenceStreamAbortedError)
      expect(mockCall.cancel).toHaveBeenCalled()
      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'cancelled' },
        expect.any(Number),
      )
    })

    it('rejects with a generic error when the stream encounters a non-cancellation error', async () => {
      const mockCall = makeMockCall()
      mockClient.AnalyzeDocument.mockReturnValue(mockCall)
      const onEvent = vi.fn()

      const promise = inferenceService.streamDocument('text', 'spark', { onEvent })
      const errorHandler = getHandler(mockCall, 'error')

      // Simulate a server-side crash mid-stream
      errorHandler({ code: 13, details: 'Internal server error' })

      await expect(promise).rejects.toThrow('Internal server error')
      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'error' },
        expect.any(Number),
      )
      expect(logger.error).toHaveBeenCalled()
    })

    it('does not emit additional events after the stream has already settled', async () => {
      const mockCall = makeMockCall()
      mockClient.AnalyzeDocument.mockReturnValue(mockCall)
      const onEvent = vi.fn()

      const promise = inferenceService.streamDocument('text', 'spark', { onEvent })
      const endHandler = getHandler(mockCall, 'end')
      const errorHandler = getHandler(mockCall, 'error')

      // Settle the stream once
      endHandler()
      await promise

      // A late-arriving error must be silently swallowed
      errorHandler({ code: 13, details: 'late error' })

      // Metrics for 'success' should only be recorded once
      const successCalls = vi.mocked(metrics.aiInferenceDuration.observe).mock.calls.filter(
        (c: any) => c[0].status === 'success',
      )
      expect(successCalls).toHaveLength(1)
    })
  })
})
