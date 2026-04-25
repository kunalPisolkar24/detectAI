import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatUIStore } from './ui-store'
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
})
