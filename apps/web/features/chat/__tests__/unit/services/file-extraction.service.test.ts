import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FileExtractionService } from '../../../services/file-extraction.service'

describe('FileExtractionService', () => {
  let service: FileExtractionService
  const BASE_URL = 'http://test-api.com'

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    service = new FileExtractionService(BASE_URL)
  })

  // ─── Successful extraction ────────────────────────────────────────────────
  describe('successful extraction', () => {
    it('returns extracted text on a 200 response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'extracted text content' }),
      } as any)

      const result = await service.extract(new FormData())

      expect(result).toBe('extracted text content')
    })

    it('posts to the correct /extract endpoint with the provided FormData', async () => {
      const formData = new FormData()
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'ok' }),
      } as any)

      await service.extract(formData)

      expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/extract`, {
        method: 'POST',
        body: formData,
      })
    })
  })

  // ─── Empty / null text ───────────────────────────────────────────────────
  describe('empty response body', () => {
    it('throws when response text is an empty string', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: '' }),
      } as any)

      await expect(service.extract(new FormData())).rejects.toThrow('No text content found in file.')
    })

    it('throws when response has no text property at all', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      } as any)

      await expect(service.extract(new FormData())).rejects.toThrow('No text content found in file.')
    })
  })

  // ─── HTTP error statuses ─────────────────────────────────────────────────
  describe('HTTP error handling', () => {
    const errorCases: [number, string][] = [
      [400, 'Invalid file signature.'],
      [413, 'File exceeds maximum allowed size.'],
      [415, 'Unsupported file type. Use PDF, DOCX, or TXT.'],
      [422, 'File is corrupt or unreadable.'],
      [500, 'Failed to extract text from file.'],
      [503, 'Failed to extract text from file.'],
    ]

    it.each(errorCases)(
      'throws the correct message for HTTP %i',
      async (status, expectedMessage) => {
        vi.mocked(fetch).mockResolvedValue({ ok: false, status } as any)

        await expect(service.extract(new FormData())).rejects.toThrow(expectedMessage)
      },
    )
  })

  // ─── Network / infrastructure failures ───────────────────────────────────
  describe('network failure', () => {
    it('propagates the error when fetch itself throws (e.g. DNS failure)', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(service.extract(new FormData())).rejects.toThrow('Failed to fetch')
    })

    it('propagates the error when fetch throws a generic Error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(service.extract(new FormData())).rejects.toThrow('ECONNREFUSED')
    })
  })
})
