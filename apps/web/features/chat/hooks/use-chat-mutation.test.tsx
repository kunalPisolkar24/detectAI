import { renderHook, act, waitFor } from '@testing-library/react'
import { useSendMessage, useChatMutations } from './use-chat-mutation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createChatAction, deleteChatAction, renameChatAction } from '@/features/chat/actions/chat'
import { useChatUIStore } from '../stores/ui-store'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import React from 'react'

vi.mock('@/features/chat/actions/chat', () => ({
  createChatAction: vi.fn(),
  deleteChatAction: vi.fn(),
  renameChatAction: vi.fn(),
}))

vi.mock('../stores/ui-store', () => {
  const mockState = {
    selectedModel: 'spark',
    currentChatId: null,
    isSidebarOpen: true,
    isRateLimited: false,
    activeAnalysisChatId: null,
    activeAnalysisMessageId: null,
    activeAnalysisCancel: null,
    isCancellingAnalysis: false,
    setModel: vi.fn(),
    setCurrentChatId: vi.fn(),
    toggleSidebar: vi.fn(),
    setSidebarOpen: vi.fn(),
    setRateLimited: vi.fn(),
    registerActiveAnalysis: vi.fn(),
    updateActiveAnalysisMessageId: vi.fn(),
    clearActiveAnalysis: vi.fn(),
    cancelActiveAnalysis: vi.fn(),
  }
  
  const useStore: any = (selector: any) => selector ? selector(mockState) : mockState
  useStore.getState = () => mockState
  useStore.setState = vi.fn()
  useStore.subscribe = vi.fn()
  
  return { useChatUIStore: useStore }
})

const mockStore = (useChatUIStore as any).getState()

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

describe('useSendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock store state
    Object.assign(mockStore, {
      selectedModel: 'spark',
      currentChatId: null,
      activeAnalysisChatId: null,
      isCancellingAnalysis: false,
    })
    // Mock fetch for streaming
    global.fetch = vi.fn()
  })

  it('creates a new chat if none exists', async () => {
    const mockChat = { id: 'chat-1', messages: [] }
    vi.mocked(createChatAction).mockResolvedValue({ success: true, data: mockChat } as any)
    
    // Mock streaming response
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'accepted', message: { id: 'msg-1', createdAt: new Date().toISOString() } }) + '\n'))
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'final', message: { id: 'msg-1', content: 'AI response', createdAt: new Date().toISOString() } }) + '\n'))
        controller.close()
      }
    })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: mockStream,
    } as any)

    const { result } = renderHook(() => useSendMessage(), { wrapper: createWrapper() })

    await act(async () => {
      result.current.sendMessage('Hello')
    })

    expect(createChatAction).toHaveBeenCalledWith('Hello')
    expect(mockStore.setCurrentChatId).toHaveBeenCalledWith('chat-1')
  })

  it('handles stream errors', async () => {
    const mockChat = { id: 'chat-1', messages: [] }
    vi.mocked(createChatAction).mockResolvedValue({ success: true, data: mockChat } as any)
    
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'error', error: 'Stream failed' }) + '\n'))
        controller.close()
      }
    })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: mockStream,
    } as any)

    const { result } = renderHook(() => useSendMessage(), { wrapper: createWrapper() })

    await act(async () => {
      try {
        await result.current.sendMessage('Hello')
      } catch (e) {}
    })

    expect(mockStore.clearActiveAnalysis).toHaveBeenCalled()
  })
})

describe('useChatMutations', () => {
  it('calls deleteChatAction and updates cache', async () => {
    vi.mocked(deleteChatAction).mockResolvedValue({ success: true, data: undefined } as any)
    
    const { result } = renderHook(() => useChatMutations(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.deleteChat.mutateAsync('chat-1')
    })

    expect(deleteChatAction).toHaveBeenCalledWith('chat-1')
  })

  it('calls renameChatAction and updates cache', async () => {
    const updatedChat = { id: 'chat-1', title: 'New Name' }
    vi.mocked(renameChatAction).mockResolvedValue({ success: true, data: updatedChat } as any)
    
    const { result } = renderHook(() => useChatMutations(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.renameChat.mutateAsync({ id: 'chat-1', title: 'New Name' })
    })

    expect(renameChatAction).toHaveBeenCalledWith('chat-1', 'New Name')
  })
})
