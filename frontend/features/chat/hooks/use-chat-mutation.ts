import { useMutation, useQueryClient } from "@tanstack/react-query"
import { chatService } from "../services"
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
        const newChat = await chatService.createChat(content)
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
        toast.error("Failed to send message")
    }
  })
}

export const useChatMutations = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { currentChatId, setCurrentChatId } = useChatUIStore()

  const deleteChat = useMutation({
    mutationFn: (chatId: string) => chatService.deleteChat(chatId),
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
    mutationFn: ({ id, title }: { id: string, title: string }) => 
      chatService.renameChat(id, title),
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