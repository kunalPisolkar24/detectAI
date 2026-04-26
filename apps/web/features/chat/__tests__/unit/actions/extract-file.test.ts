import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractTextFromFile } from '../../../actions/extract-file'
import { fileExtractionService } from '../../../services/file-extraction.service'

vi.mock('../../../services/file-extraction.service', () => ({
  fileExtractionService: {
    extract: vi.fn(),
  },
}))

describe('extractTextFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('successfully extracts text', async () => {
    const mockText = 'Extracted text'
    vi.mocked(fileExtractionService.extract).mockResolvedValue(mockText)
    
    const formData = new FormData()
    const result = await extractTextFromFile(formData)

    expect(result).toEqual({ success: true, text: mockText })
  })

  it('handles service errors', async () => {
    vi.mocked(fileExtractionService.extract).mockRejectedValue(new Error('Extraction failed'))
    
    const formData = new FormData()
    const result = await extractTextFromFile(formData)

    expect(result).toEqual({ error: 'Extraction failed' })
  })

  it('returns default error if non-Error is thrown', async () => {
    vi.mocked(fileExtractionService.extract).mockRejectedValue('Something bad')
    
    const formData = new FormData()
    const result = await extractTextFromFile(formData)

    expect(result).toEqual({ error: 'Service unavailable. Please try again later.' })
  })
})
