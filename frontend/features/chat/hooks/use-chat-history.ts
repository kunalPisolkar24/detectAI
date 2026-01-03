import { useQuery } from "@tanstack/react-query"
import { chatService } from "../services"
import { ChatSession, ChatHistoryItem } from "../types"

export const useChatSession = (chatId: string | null) => {
  return useQuery<ChatSession>({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      if (!chatId) throw new Error("No chat ID provided")
      return chatService.getChat(chatId)
    },
    enabled: !!chatId,
    staleTime: 1000 * 60 * 5, 
  })
}

export const useChatHistory = () => {
  return useQuery<ChatHistoryItem[]>({
    queryKey: ["chat-history"],
    queryFn: async () => chatService.getHistory(),
    staleTime: 1000 * 30,
  })
}