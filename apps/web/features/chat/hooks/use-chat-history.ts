import { useQuery } from "@tanstack/react-query"
import { getChatSession, getChatHistory } from "../actions/chat"

export const useChatSession = (chatId: string | null) => {
  return useQuery({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      if (!chatId) throw new Error("No chat ID provided")
      return getChatSession(chatId)
    },
    enabled: !!chatId,
    staleTime: 1000 * 60 * 5, 
  })
}

export const useChatHistory = () => {
  return useQuery({
    queryKey: ["chat-history"],
    queryFn: async () => getChatHistory(),
    staleTime: 1000 * 30,
  })
}