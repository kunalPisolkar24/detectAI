import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileExtractionService } from './file-extraction.service'

describe('FileExtractionService', () => {
  let service: FileExtractionService
  const baseUrl = 'http://test-api.com'

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    service = new FileExtractionService(baseUrl)
  })

  it('should return text on successful extraction', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: 'extracted text' }),
    } as any)

    const formData = new FormData()
    const text = await service.extract(formData)

    expect(text).toBe('extracted text')
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/extract`, expect.objectContaining({
      method: 'POST',
      body: formData,
    }))
  })

  it('should throw "No text content found in file." if data.text is empty', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ text: '' }),
    } as any)

    await expect(service.extract(new FormData())).rejects.toThrow('No text content found in file.')
  })

  it('should handle 415 error correctly', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 415,
    } as any)

    await expect(service.extract(new FormData())).rejects.toThrow('Unsupported file type. Use PDF, DOCX, or TXT.')
  })

  it('should handle default error for unknown status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as any)

    await expect(service.extract(new FormData())).rejects.toThrow('Failed to extract text from file.')
  })
})
