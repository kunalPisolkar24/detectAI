import { create } from "zustand"
import { ModelType } from "../types"
import { persist } from "zustand/middleware"

interface ChatUIState {
  selectedModel: ModelType
  currentChatId: string | null
  isSidebarOpen: boolean
  userType: "free" | "premium"
  isRateLimited: boolean
  setModel: (model: ModelType) => void
  setCurrentChatId: (id: string | null) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setUserType: (type: "free" | "premium") => void
  setRateLimited: (limited: boolean) => void
}

export const useChatUIStore = create<ChatUIState>()(
  persist(
    (set) => ({
      selectedModel: "spark",
      currentChatId: null,
      isSidebarOpen: true,
      userType: "free",
      isRateLimited: false,
      setModel: (model) => set({ selectedModel: model }),
      setCurrentChatId: (id) => set({ currentChatId: id }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      setUserType: (type) => set({ userType: type }),
      setRateLimited: (limited) => set({ isRateLimited: limited })
    }),
    {
      name: "chat-ui-storage",
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        isSidebarOpen: state.isSidebarOpen,
        userType: state.userType
      }),
    }
  )
)