import { create } from "zustand"
import { ModelType } from "../types"
import { persist } from "zustand/middleware"

interface ChatUIState {
  selectedModel: ModelType
  currentChatId: string | null
  isSidebarOpen: boolean
  isRateLimited: boolean
  activeAnalysisChatId: string | null
  activeAnalysisMessageId: string | null
  activeAnalysisCancel: (() => void) | null
  isCancellingAnalysis: boolean
  setModel: (model: ModelType) => void
  setCurrentChatId: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setRateLimited: (limited: boolean) => void
  registerActiveAnalysis: (input: { chatId: string; messageId: string; cancel: () => void }) => void
  updateActiveAnalysisMessageId: (messageId: string) => void
  clearActiveAnalysis: () => void
  cancelActiveAnalysis: () => void
}

export const useChatUIStore = create<ChatUIState>()(
  persist(
    (set, get) => ({
      selectedModel: "spark",
      currentChatId: null,
      isSidebarOpen: true,
      isRateLimited: false,
      activeAnalysisChatId: null,
      activeAnalysisMessageId: null,
      activeAnalysisCancel: null,
      isCancellingAnalysis: false,
      setModel: (model) => set({ selectedModel: model }),
      setCurrentChatId: (id) => set({ currentChatId: id }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      setRateLimited: (limited) => set({ isRateLimited: limited }),
      registerActiveAnalysis: ({ chatId, messageId, cancel }) =>
        set({
          activeAnalysisChatId: chatId,
          activeAnalysisMessageId: messageId,
          activeAnalysisCancel: cancel,
          isCancellingAnalysis: false,
        }),
      updateActiveAnalysisMessageId: (messageId) =>
        set((state) => {
          if (!state.activeAnalysisChatId) {
            return state
          }

          return {
            activeAnalysisMessageId: messageId,
          }
        }),
      clearActiveAnalysis: () =>
        set({
          activeAnalysisChatId: null,
          activeAnalysisMessageId: null,
          activeAnalysisCancel: null,
          isCancellingAnalysis: false,
        }),
      cancelActiveAnalysis: () => {
        const state = get()
        if (!state.activeAnalysisChatId || !state.activeAnalysisMessageId || state.isCancellingAnalysis || !state.activeAnalysisCancel) {
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
