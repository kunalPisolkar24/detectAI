import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeText } from './analyze'
import { getServerSession } from 'next-auth'
import { rateLimitService } from '@/features/rate-limit/services/rate-limit-service'
import { inferenceService } from '../services/inference-service'
import { MAX_LIVE_ANALYSIS_CHARS } from '../constants'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/config/auth-options', () => ({
  authOptions: {},
}))

vi.mock('@/features/rate-limit/services/rate-limit-service', () => ({
  rateLimitService: {
    checkLimit: vi.fn(),
    trackUsage: vi.fn(),
  },
}))

vi.mock('../services/inference-service', () => ({
  inferenceService: {
    detect: vi.fn(),
  },
}))

describe('analyzeText', () => {
  const mockUser = { id: 'user-1', isPremium: false }
  const mockContent = 'Some text to analyze'
  const mockModel = 'gpt-3.5-turbo' as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error if unauthorized', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const result = await analyzeText(mockContent, mockModel)
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('returns error if rate limit exceeded', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
    vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: false } as any)

    const result = await analyzeText(mockContent, mockModel)

    expect(result).toEqual({ success: false, error: 'Rate limit exceeded', isRateLimit: true })
  })

  it('returns error if content exceeds max length', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
    vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: true } as any)

    const longContent = 'a'.repeat(MAX_LIVE_ANALYSIS_CHARS + 1)
    const result = await analyzeText(longContent, mockModel)

    expect(result).toEqual({
      success: false,
      error: `Text exceeds maximum length of ${MAX_LIVE_ANALYSIS_CHARS} characters`
    })
  })

  it('performs analysis and tracks usage if all checks pass', async () => {
    const mockAnalysis = { score: 0.9, label: 'ai' }
    vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
    vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: true } as any)
    vi.mocked(inferenceService.detect).mockResolvedValue(mockAnalysis as any)

    const result = await analyzeText(mockContent, mockModel)

    expect(inferenceService.detect).toHaveBeenCalledWith(mockContent, mockModel)
    expect(rateLimitService.trackUsage).toHaveBeenCalledWith(mockUser.id)
    expect(result).toEqual({ success: true, data: mockAnalysis })
  })

  it('returns error if inference service fails', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: mockUser } as any)
    vi.mocked(rateLimitService.checkLimit).mockResolvedValue({ allowed: true } as any)
    vi.mocked(inferenceService.detect).mockRejectedValue(new Error('Inference failed'))

    const result = await analyzeText(mockContent, mockModel)

    expect(result).toEqual({ success: false, error: 'Inference failed' })
  })
})
