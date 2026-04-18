import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inferenceService } from './inference-service'
import { getGrpcClient, getGrpcMetadata } from '@/lib/grpc-client'
import { metrics } from '@/lib/metrics'

vi.mock('@/lib/grpc-client')
vi.mock('@/lib/grpc-metadata', () => ({ getGrpcMetadata: vi.fn() }))
vi.mock('@/lib/metrics', () => ({ metrics: { aiInferenceDuration: { observe: vi.fn() } } }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

describe('inferenceService', () => {
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = {
      Detect: vi.fn(),
      AnalyzeDocument: vi.fn(),
    }
    vi.mocked(getGrpcClient).mockReturnValue(mockClient)
  })

  describe('detect', () => {
    it('should call Detect and map response to AnalysisResult', async () => {
      const mockProtoResponse = {
        model_name: 'spark',
        label: 'AI',
        is_ai_generated: true,
        confidence_score: 95,
        human_confidence: 5,
        ai_confidence: 95,
        highlight_spans: [
          { char_start: 0, char_end: 5, ai_confidence: 90 }
        ]
      }

      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => {
        cb(null, mockProtoResponse)
      })

      const result = await inferenceService.detect('text', 'spark')

      expect(result.label).toBe('AI')
      expect(result.confidence).toBe(0.95)
      expect(result.scores.ai).toBe(0.95)
      expect(result.highlights[0].charStart).toBe(0)
      expect(result.highlights[0].label).toBe('AI')
      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'success' },
        expect.any(Number)
      )
    })

    it('should throw error if Detect fails', async () => {
      mockClient.Detect.mockImplementation((data: any, meta: any, cb: any) => {
        cb(new Error('GRPC Fail'))
      })

      await expect(inferenceService.detect('text', 'spark')).rejects.toThrow('AI Analysis Service Unavailable')
      expect(metrics.aiInferenceDuration.observe).toHaveBeenCalledWith(
        { model: 'spark', status: 'error' },
        expect.any(Number)
      )
    })
  })

  describe('streamDocument', () => {
    it('should call onEvent for started, progress, and final events', async () => {
      const mockCall = {
        on: vi.fn(),
        cancel: vi.fn(),
      }
      mockClient.AnalyzeDocument.mockReturnValue(mockCall)

      const onEvent = vi.fn()
      const promise = inferenceService.streamDocument('text', 'spark', { onEvent })

      // Simulate events
      const dataCallback = mockCall.on.mock.calls.find((call: any) => call[0] === 'data')?.[1]
      const endCallback = mockCall.on.mock.calls.find((call: any) => call[0] === 'end')?.[1]

      dataCallback({ event: 'started', started: { total_chars: 100, total_chunks: 10 } })
      dataCallback({ event: 'progress', progress: { processed_chunks: 1, total_chunks: 10 } })
      dataCallback({ event: 'final', final: { model_name: 'spark', is_ai_generated: true, confidence_score: 90, human_confidence: 10, ai_confidence: 90 } })
      
      endCallback()

      await promise

      expect(onEvent).toHaveBeenCalledWith({ type: 'started', totalChars: 100, totalChunks: 10 })
      expect(onEvent).toHaveBeenCalledWith({ type: 'progress', processedChunks: 1, totalChunks: 10 })
      expect(onEvent).toHaveBeenCalledWith({ type: 'final', result: expect.objectContaining({ label: 'AI' }) })
    })
  })
})
