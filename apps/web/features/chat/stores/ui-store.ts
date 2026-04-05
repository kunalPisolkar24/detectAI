import { create } from "zustand"
import { ModelType } from "../types"
import { persist } from "zustand/middleware"

interface ChatUIState {
  selectedModel: ModelType
  currentChatId: string | null
  isSidebarOpen: boolean
  isRateLimited: boolean
  activeAnalysisMessageId: string | null
  activeAnalysisCancel: (() => void) | null
  isCancellingAnalysis: boolean
  setModel: (model: ModelType) => void
  setCurrentChatId: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setRateLimited: (limited: boolean) => void
  registerActiveAnalysis: (messageId: string, cancel: () => void) => void
  clearActiveAnalysis: (messageId?: string | null) => void
  cancelActiveAnalysis: () => void
}

export const useChatUIStore = create<ChatUIState>()(
  persist(
    (set, get) => ({
      selectedModel: "spark",
      currentChatId: null,
      isSidebarOpen: true,
      isRateLimited: false,
      activeAnalysisMessageId: null,
      activeAnalysisCancel: null,
      isCancellingAnalysis: false,
      setModel: (model) => set({ selectedModel: model }),
      setCurrentChatId: (id) => set({ currentChatId: id }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      setRateLimited: (limited) => set({ isRateLimited: limited }),
      registerActiveAnalysis: (messageId, cancel) =>
        set({
          activeAnalysisMessageId: messageId,
          activeAnalysisCancel: cancel,
          isCancellingAnalysis: false,
        }),
      clearActiveAnalysis: (messageId) =>
        set((state) => {
          if (messageId && state.activeAnalysisMessageId && state.activeAnalysisMessageId !== messageId) {
            return state
          }

          return {
            activeAnalysisMessageId: null,
            activeAnalysisCancel: null,
            isCancellingAnalysis: false,
          }
        }),
      cancelActiveAnalysis: () => {
        const state = get()
        if (!state.activeAnalysisMessageId || state.isCancellingAnalysis || !state.activeAnalysisCancel) {
          return
        }

        set({ isCancellingAnalysis: true })
        state.activeAnalysisCancel()
      },
    }),
    {
      name: "chat-ui-storage",
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        isSidebarOpen: state.isSidebarOpen,
      }),
    }
  )
)
