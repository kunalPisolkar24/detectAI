import { useMutation, useQueryClient } from "@tanstack/react-query"
import { chatService } from "../services/mock-service"
import { useChatUIStore } from "../stores/ui-store"
import { Message, ChatSession } from "../types"

export const useSendMessage = () => {
  const queryClient = useQueryClient()
  const { currentChatId, selectedModel, setCurrentChatId } = useChatUIStore()

  return useMutation({
    mutationFn: async (content: string) => {
      let chatId = currentChatId

      if (!chatId) {
        const newChat = await chatService.createChat(content)
        chatId = newChat.id
        setCurrentChatId(chatId)
        queryClient.setQueryData<ChatSession>(["chat", chatId], { ...newChat, messages: [] })
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date()
      }

      queryClient.setQueryData<ChatSession>(["chat", chatId], (old) => {
        if (!old) return undefined
        return {
          ...old,
          messages: [...old.messages, userMsg]
        }
      })

      return chatService.sendMessage(chatId, content, selectedModel)
    },
    onSuccess: (data) => {
      const chatId = useChatUIStore.getState().currentChatId
      if (chatId) {
        queryClient.setQueryData<ChatSession>(["chat", chatId], (old) => {
          if (!old) return undefined
          return {
            ...old,
            messages: [...old.messages, data]
          }
        })
      }
    }
  })
}