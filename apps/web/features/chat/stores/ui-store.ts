import { create } from "zustand"
import { ModelType } from "../types"
import { persist } from "zustand/middleware"

interface ChatUIState {
  selectedModel: ModelType
  currentChatId: string | null
  isSidebarOpen: boolean
  isRateLimited: boolean
  setModel: (model: ModelType) => void
  setCurrentChatId: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setRateLimited: (limited: boolean) => void
}

export const useChatUIStore = create<ChatUIState>()(
  persist(
    (set) => ({
      selectedModel: "spark",
      currentChatId: null,
      isSidebarOpen: true,
      isRateLimited: false,
      setModel: (model) => set({ selectedModel: model }),
      setCurrentChatId: (id) => set({ currentChatId: id }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      setRateLimited: (limited) => set({ isRateLimited: limited })
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