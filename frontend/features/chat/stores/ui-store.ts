import { create } from "zustand"
import { ModelType } from "../types"

interface ChatUIState {
  selectedModel: ModelType
  currentChatId: string | null
  setModel: (model: ModelType) => void
  setCurrentChatId: (id: string | null) => void
}

export const useChatUIStore = create<ChatUIState>((set) => ({
  selectedModel: "spark",
  currentChatId: null,
  setModel: (model) => set({ selectedModel: model }),
  setCurrentChatId: (id) => set({ currentChatId: id })
}))