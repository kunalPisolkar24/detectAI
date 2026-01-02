import { useMutation, useQueryClient } from "@tanstack/react-query"
import { chatService } from "../services"
import { useChatUIStore } from "../stores/ui-store"
import { Message, ChatSession } from "../types"

export const useSendMessage = () => {
  const queryClient = useQueryClient()
  const { currentChatId, selectedModel, setCurrentChatId } = useChatUIStore()

  return useMutation({
    mutationFn: async (content: string) => {
      let activeChatId = currentChatId

      if (!activeChatId) {
        const newChat = await chatService.createChat(content)
        activeChatId = newChat.id
        setCurrentChatId(activeChatId)
        
        queryClient.setQueryData<ChatSession>(["chat", activeChatId], { 
          ...newChat, 
          messages: [] 
        })
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

      return chatService.sendMessage(activeChatId, content, selectedModel)
    },
    onSuccess: (newMessage, _, context) => {
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
    }
  })
}