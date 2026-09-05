import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ChatView } from '../../components/chat-view'
import { render } from '@/test/custom-renderer'
import { useSession } from 'next-auth/react'
import { createChatAction, getChatHistoryAction } from '../../actions/chat'
import { useChatUIStore } from '../../stores/ui-store'

vi.mock('../../actions/chat', async () => {
  const actual = await vi.importActual<any>('../../actions/chat')
  return {
    ...actual,
    createChatAction: vi.fn(),
    getChatHistoryAction: vi.fn(),
    getChatAction: vi.fn(),
  }
})

vi.mock('../../actions/extract-file', () => ({
  extractTextFromFile: vi.fn(),
}))

const LONG_MESSAGE =
  'This is a test message that needs to be at least one hundred words long to pass the validation check in the chat input component. '.repeat(10)

describe('Chat Interaction Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()

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

  it('renders chat view with input area', () => {
    render(<ChatView />)

    expect(screen.getByLabelText(/text to analyze/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/analyze text/i)).toBeInTheDocument()
    expect(screen.getByText(/Know in seconds\./i)).toBeInTheDocument()
  })

  it('submits text and displays analysis result', async () => {
    render(<ChatView />)

    const textarea = screen.getByLabelText(/text to analyze/i)
    fireEvent.change(textarea, { target: { value: LONG_MESSAGE } })

    const sendButton = screen.getByLabelText(/analyze text/i)
    fireEvent.click(sendButton)

    await waitFor(
      () => {
        expect(createChatAction).toHaveBeenCalledWith(LONG_MESSAGE)
      },
      { timeout: 3000 },
    )

    expect(await screen.findByText(/ai-generated/i, {}, { timeout: 5000 })).toBeInTheDocument()
  }, 15000)

  it('shows rate limit banner when rate limited', () => {
    render(<ChatView initialRateLimited={true} />)

    expect(screen.getByText(/usage limit reached/i)).toBeInTheDocument()
    expect(screen.getByText(/upgrade now/i)).toBeInTheDocument()
  })

  it('disables input when rate limited for free users', () => {
    render(<ChatView initialRateLimited={true} />)

    const textarea = screen.getByLabelText(/text to analyze/i)
    expect(textarea).toBeDisabled()
  })

  it('shows empty state when no messages exist', () => {
    render(<ChatView />)

    expect(screen.getByText(/Know in seconds\./i)).toBeInTheDocument()
    expect(screen.getByText(/chunk-level analysis/i)).toBeInTheDocument()
  })
})
