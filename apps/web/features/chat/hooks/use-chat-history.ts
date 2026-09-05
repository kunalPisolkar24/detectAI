import { useQuery } from "@tanstack/react-query"
import { getChatAction, getChatHistoryAction } from "@/features/chat/actions/chat"
import { ChatSession, ChatHistoryItem } from "../types"
import { isPreviewModeClient } from "@/lib/config/preview"

export const useChatSession = (chatId: string | null) => {
  return useQuery<ChatSession>({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      if (!chatId) throw new Error("No chat ID provided")

      if (isPreviewModeClient()) {
        const { previewGetChat } = await import("@/features/preview/lib/preview-db")
        return previewGetChat(chatId)
      }
      
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
      if (isPreviewModeClient()) {
        const { previewGetHistory } = await import("@/features/preview/lib/preview-db")
        return previewGetHistory()
      }
      const result = await getChatHistoryAction()
      
      if (!result.success) {
        throw new Error(result.error)
      }
      
      return result.data
    },
    staleTime: 1000 * 30,
  })
}