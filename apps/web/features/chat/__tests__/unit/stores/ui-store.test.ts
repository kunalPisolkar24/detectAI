import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatUIStore } from '../../../stores/ui-store'
import { act } from '@testing-library/react'

describe('useChatUIStore', () => {
  beforeEach(() => {
    act(() => {
      useChatUIStore.getState().clearActiveAnalysis()
      useChatUIStore.getState().setCurrentChatId(null)
      useChatUIStore.getState().setModel('spark')
    })
  })

  it('initializes with default values', () => {
    const state = useChatUIStore.getState()
    expect(state.selectedModel).toBe('spark')
    expect(state.currentChatId).toBeNull()
    expect(state.isSidebarOpen).toBe(true)
  })

  it('updates model', () => {
    act(() => {
      useChatUIStore.getState().setModel('flare')
    })
    expect(useChatUIStore.getState().selectedModel).toBe('flare')
  })

  it('toggles sidebar', () => {
    const initial = useChatUIStore.getState().isSidebarOpen
    act(() => {
      useChatUIStore.getState().toggleSidebar()
    })
    expect(useChatUIStore.getState().isSidebarOpen).toBe(!initial)
  })

  it('registers and clears active analysis', () => {
    const cancel = vi.fn()
    act(() => {
      useChatUIStore.getState().registerActiveAnalysis({
        chatId: 'chat-1',
        messageId: 'msg-1',
        cancel,
      })
    })
    
    let state = useChatUIStore.getState()
    expect(state.activeAnalysisChatId).toBe('chat-1')
    expect(state.activeAnalysisMessageId).toBe('msg-1')
    
    act(() => {
      state.cancelActiveAnalysis()
    })
    expect(cancel).toHaveBeenCalled()
    expect(useChatUIStore.getState().isCancellingAnalysis).toBe(true)
    
    act(() => {
      useChatUIStore.getState().clearActiveAnalysis()
    })
    expect(useChatUIStore.getState().activeAnalysisChatId).toBeNull()
  })

  it('sets sidebar open state', () => {
    act(() => {
      useChatUIStore.getState().setSidebarOpen(false)
    })
    expect(useChatUIStore.getState().isSidebarOpen).toBe(false)
    act(() => {
      useChatUIStore.getState().setSidebarOpen(true)
    })
    expect(useChatUIStore.getState().isSidebarOpen).toBe(true)
  })

  it('sets rate limited state', () => {
    act(() => {
      useChatUIStore.getState().setRateLimited(true)
    })
    expect(useChatUIStore.getState().isRateLimited).toBe(true)
    act(() => {
      useChatUIStore.getState().setRateLimited(false)
    })
    expect(useChatUIStore.getState().isRateLimited).toBe(false)
  })

  it('updates active analysis message id', () => {
    act(() => {
      useChatUIStore.getState().registerActiveAnalysis({
        chatId: 'chat-1',
        messageId: 'msg-1',
        cancel: () => {},
      })
      useChatUIStore.getState().updateActiveAnalysisMessageId('msg-2')
    })
    expect(useChatUIStore.getState().activeAnalysisMessageId).toBe('msg-2')
  })

  it('does not update message id if no active analysis', () => {
    act(() => {
      useChatUIStore.getState().clearActiveAnalysis()
      useChatUIStore.getState().updateActiveAnalysisMessageId('msg-2')
    })
    expect(useChatUIStore.getState().activeAnalysisMessageId).toBeNull()
  })

  it('does not cancel if no active analysis or already cancelling', () => {
    const cancel = vi.fn()
    act(() => {
      useChatUIStore.getState().clearActiveAnalysis()
      useChatUIStore.getState().cancelActiveAnalysis()
    })
    expect(cancel).not.toHaveBeenCalled()

    act(() => {
      useChatUIStore.getState().registerActiveAnalysis({
        chatId: 'chat-1',
        messageId: 'msg-1',
        cancel,
      })
      // Manually set isCancellingAnalysis to true
      useChatUIStore.setState({ isCancellingAnalysis: true })
      useChatUIStore.getState().cancelActiveAnalysis()
    })
    expect(cancel).not.toHaveBeenCalled()
  })
})

