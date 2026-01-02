import { useQuery } from "@tanstack/react-query"
import { chatService } from "../services"
import { ChatSession } from "../types"

export const useChatHistory = (chatId: string | null) => {
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