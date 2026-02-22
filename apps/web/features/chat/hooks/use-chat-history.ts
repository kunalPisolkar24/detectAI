import { useQuery } from "@tanstack/react-query"
import { getChatAction, getChatHistoryAction } from "@/features/chat/actions/chat"
import { ChatSession, ChatHistoryItem } from "../types"

export const useChatSession = (chatId: string | null) => {
  return useQuery<ChatSession>({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      if (!chatId) throw new Error("No chat ID provided")
      
      const result = await getChatAction(chatId)
      
      if (!result.success) {
        throw new Error(result.error)
      }
      
      return result.data
    },
    enabled: !!chatId,
    staleTime: 1000 * 60 * 5, 
  })
}

export const useChatHistory = () => {
  return useQuery<ChatHistoryItem[]>({
    queryKey: ["chat-history"],
    queryFn: async () => {
      const result = await getChatHistoryAction()
      
      if (!result.success) {
        throw new Error(result.error)
      }
      
      return result.data
    },
    staleTime: 1000 * 30,
  })
}