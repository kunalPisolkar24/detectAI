import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createChatAction, sendMessageAction, deleteChatAction, renameChatAction } from "@/features/chat/actions/chat"
import { useChatUIStore } from "../stores/ui-store"
import { Message, ChatSession, ChatHistoryItem } from "../types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export const useSendMessage = () => {
  const queryClient = useQueryClient()
  const { currentChatId, selectedModel, setCurrentChatId } = useChatUIStore()

  return useMutation({
    mutationFn: async (content: string) => {
      let activeChatId = currentChatId

      if (!activeChatId) {
        const createResult = await createChatAction(content)

        if (!createResult.success) {
          throw new Error(createResult.error)
        }

        const newChat = createResult.data
        activeChatId = newChat.id
        setCurrentChatId(activeChatId)

        queryClient.setQueryData<ChatSession>(["chat", activeChatId], {
          ...newChat,
          messages: []
        })

        await queryClient.invalidateQueries({ queryKey: ["chat-history"] })
      }

      const optimisticMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date()
      }

      queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
        if (!old) return undefined
        return {
          ...old,
          messages: [...old.messages, optimisticMessage]
        }
      })

      const sendResult = await sendMessageAction(activeChatId, content, selectedModel)

      if (!sendResult.success) {
        throw new Error(sendResult.error)
      }

      return sendResult.data
    },
    onSuccess: (newMessage) => {
      useChatUIStore.getState().setRateLimited(false)

      const activeChatId = useChatUIStore.getState().currentChatId

      if (activeChatId) {
        queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
          if (!old) return undefined
          return {
            ...old,
            messages: [...old.messages, newMessage]
          }
        })
      }
    },
    onError: (error) => {
      console.error("Failed to send message", error)
      if (error instanceof Error && (error.message.includes("Rate limit") || error.message.includes("429"))) {
        useChatUIStore.getState().setRateLimited(true)
        toast.error("Rate limit exceeded")
      } else {
        toast.error("Failed to send message")
      }
    }
  })
}

export const useChatMutations = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { currentChatId, setCurrentChatId } = useChatUIStore()

  const deleteChat = useMutation({
    mutationFn: async (chatId: string) => {
      const result = await deleteChatAction(chatId)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (_, chatId) => {
      queryClient.setQueryData<ChatHistoryItem[]>(["chat-history"], (old) =>
        old?.filter(c => c.id !== chatId) || []
      )

      if (currentChatId === chatId) {
        setCurrentChatId(null)
        router.push("/chat")
      }
      toast.success("Chat deleted")
    },
    onError: () => toast.error("Failed to delete chat")
  })

  const renameChat = useMutation({
    mutationFn: async ({ id, title }: { id: string, title: string }) => {
      const result = await renameChatAction(id, title)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (updatedChat) => {
      queryClient.setQueryData<ChatHistoryItem[]>(["chat-history"], (old) =>
        old?.map(c => c.id === updatedChat.id ? updatedChat : c) || []
      )
      queryClient.invalidateQueries({ queryKey: ["chat", updatedChat.id] })
      toast.success("Chat renamed")
    },
    onError: () => toast.error("Failed to rename chat")
  })

  return { deleteChat, renameChat }
}