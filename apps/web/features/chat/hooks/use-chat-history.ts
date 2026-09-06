import { useQuery } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { getChatAction, getChatHistoryAction } from "@/features/chat/actions/chat"
import { ChatSession, ChatHistoryItem } from "../types"
import { getPreviewUserId, isPreviewModeClient } from "@/lib/config/preview"

const usePreviewUserId = (): string | null => {
  const { data: session } = useSession()
  if (!isPreviewModeClient()) return null
  return getPreviewUserId(session?.user)
}

export const useChatSession = (chatId: string | null) => {
  const previewUserId = usePreviewUserId()
  return useQuery<ChatSession>({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      if (!chatId) throw new Error("No chat ID provided")

      if (isPreviewModeClient()) {
        if (!previewUserId) throw new Error("Not authenticated")
        const { previewGetChat } = await import("@/features/preview/lib/preview-db")
        return previewGetChat(previewUserId, chatId)
      }

      const result = await getChatAction(chatId)

      if (!result.success) {
        throw new Error(result.error)
      }

      return result.data
    },
    enabled: !!chatId && (!isPreviewModeClient() || !!previewUserId),
    staleTime: 1000 * 60 * 5,
  })
}

export const useChatHistory = () => {
  const previewUserId = usePreviewUserId()
  return useQuery<ChatHistoryItem[]>({
    queryKey: ["chat-history"],
    queryFn: async () => {
      if (isPreviewModeClient()) {
        if (!previewUserId) throw new Error("Not authenticated")
        const { previewGetHistory } = await import("@/features/preview/lib/preview-db")
        return previewGetHistory(previewUserId)
      }
      const result = await getChatHistoryAction()

      if (!result.success) {
        throw new Error(result.error)
      }

      return result.data
    },
    enabled: !isPreviewModeClient() || !!previewUserId,
    staleTime: 1000 * 30,
  })
}
