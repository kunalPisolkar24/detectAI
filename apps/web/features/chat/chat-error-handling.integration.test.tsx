import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ChatView } from './components/chat-view'
import { render } from '@/test/custom-renderer'
import { useSession } from 'next-auth/react'
import { createChatAction, getChatHistoryAction } from './actions/chat'
import { extractTextFromFile } from './actions/extract-file'
import { server } from '@/test/msw-server'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { useChatUIStore } from './stores/ui-store'

vi.mock('./actions/chat', async () => {
  const actual = await vi.importActual<any>('./actions/chat')
  return {
    ...actual,
    createChatAction: vi.fn(),
    getChatHistoryAction: vi.fn(),
    getChatAction: vi.fn(),
  }
})

vi.mock('./actions/extract-file', () => ({
  extractTextFromFile: vi.fn(),
}))

const LONG_MESSAGE = 'This is a test message that needs to be at least one hundred words long to pass the validation check in the chat input component. '.repeat(10)

describe('Chat Error Handling Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()

    useChatUIStore.setState({
      isRateLimited: false,
      currentChatId: null,
      activeAnalysisChatId: null,
      activeAnalysisMessageId: null,
      activeAnalysisCancel: null,
      isCancellingAnalysis: false,
    })

    vi.mocked(useSession).mockReturnValue({
      data: {
        user: { id: 'user-123', name: 'Test User', email: 'test@example.com', isPremium: false },
        expires: '9999-12-31T23:59:59.999Z',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    vi.mocked(createChatAction).mockResolvedValue({
      success: true,
      data: {
        id: 'chat-123',
        title: 'New Chat',
        messages: [],
        updatedAt: new Date(),
      },
    })

    vi.mocked(getChatHistoryAction).mockResolvedValue({
      success: true,
      data: [],
    })
  })

  it('handles server errors during chat analysis', async () => {
    server.use(
      http.post('/api/chat/analyze/stream', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )

    render(<ChatView initialRateLimited={false} />)

    const textarea = screen.getByLabelText(/text to analyze/i)
    fireEvent.change(textarea, { target: { value: LONG_MESSAGE } })

    const sendButton = screen.getByLabelText(/analyze text/i)
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
  })

  it('activates rate limit mode on 429 response', async () => {
    server.use(
      http.post('/api/chat/analyze/stream', () => {
        return new HttpResponse(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<ChatView initialRateLimited={false} />)

    const textarea = screen.getByLabelText(/text to analyze/i)
    fireEvent.change(textarea, { target: { value: LONG_MESSAGE } })

    const sendButton = screen.getByLabelText(/analyze text/i)
    fireEvent.click(sendButton)

    await waitFor(() => {
      expect(useChatUIStore.getState().isRateLimited).toBe(true)
    })

    await waitFor(() => {
      expect(screen.getByText(/usage limit reached/i)).toBeInTheDocument()
    })
  })

  it('handles file extraction failures gracefully', async () => {
    vi.mocked(extractTextFromFile).mockResolvedValue({
      error: 'Unsupported file format',
    })

    render(<ChatView initialRateLimited={false} />)

    const fileInput = screen.getByLabelText(/upload document/i) as HTMLInputElement
    const file = new File(['test content'], 'test.pdf', { type: 'application/pdf' })

    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: false,
    })
    fireEvent.change(fileInput)

    await waitFor(() => {
      expect(extractTextFromFile).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Unsupported file format')
    })
  })

  it('disables submit when text exceeds character limit', () => {
    const overLimitText = 'a '.repeat(26000)

    render(<ChatView initialRateLimited={false} />)

    const textarea = screen.getByLabelText(/text to analyze/i)
    fireEvent.change(textarea, { target: { value: overLimitText } })

    const sendButton = screen.getByLabelText(/analyze text/i)
    expect(sendButton).toBeDisabled()
  })

  it('prevents submission when word count is below minimum', () => {
    render(<ChatView initialRateLimited={false} />)

    const textarea = screen.getByLabelText(/text to analyze/i)
    fireEvent.change(textarea, { target: { value: 'too few words here' } })

    const sendButton = screen.getByLabelText(/analyze text/i)
    fireEvent.click(sendButton)

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('100'),
    )
  })
})
