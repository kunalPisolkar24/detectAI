import { create } from "zustand"
import { ModelType } from "../types"

interface ChatUIState {
  selectedModel: ModelType
  input: string
  currentChatId: string | null
  setModel: (model: ModelType) => void
  setInput: (value: string) => void
  setCurrentChatId: (id: string | null) => void
}

export const useChatUIStore = create<ChatUIState>((set) => ({
  selectedModel: "spark",
  input: "",
  currentChatId: null,
  setModel: (model) => set({ selectedModel: model }),
  setInput: (value) => set({ input: value }),
  setCurrentChatId: (id) => set({ currentChatId: id })
}))