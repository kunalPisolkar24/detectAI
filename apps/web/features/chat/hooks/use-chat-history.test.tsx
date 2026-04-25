import { renderHook, waitFor } from '@testing-library/react'
import { useChatSession, useChatHistory } from './use-chat-history'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getChatAction, getChatHistoryAction } from '@/features/chat/actions/chat'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'

vi.mock('@/features/chat/actions/chat', () => ({
  getChatAction: vi.fn(),
  getChatHistoryAction: vi.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches chat session correctly', async () => {
    const mockChat = { id: 'chat-1', messages: [] }
    vi.mocked(getChatAction).mockResolvedValue({ success: true, data: mockChat } as any)

    const { result } = renderHook(() => useChatSession('chat-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockChat)
    expect(getChatAction).toHaveBeenCalledWith('chat-1')
  })

  it('handles errors when fetching session', async () => {
    vi.mocked(getChatAction).mockResolvedValue({ success: false, error: 'Not found' } as any)

    const { result } = renderHook(() => useChatSession('chat-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('Not found')
  })
})

describe('useChatHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches chat history correctly', async () => {
    const mockHistory = [{ id: 'chat-1', title: 'Test' }]
    vi.mocked(getChatHistoryAction).mockResolvedValue({ success: true, data: mockHistory } as any)

    const { result } = renderHook(() => useChatHistory(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(mockHistory)
  })
})
