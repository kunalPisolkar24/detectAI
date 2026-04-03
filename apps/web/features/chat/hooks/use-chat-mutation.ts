import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createChatAction, deleteChatAction, renameChatAction } from "@/features/chat/actions/chat"
import { useChatUIStore } from "../stores/ui-store"
import { Message, ChatSession, ChatHistoryItem } from "../types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

interface SerializedMessage extends Omit<Message, "createdAt"> {
  createdAt: string
}

type StreamEvent =
  | { type: "started"; totalChars: number; totalChunks: number }
  | { type: "progress"; processedChunks: number; totalChunks: number }
  | { type: "final"; message: SerializedMessage }
  | { type: "error"; error: string }

class StreamingChatError extends Error {
  constructor(
    message: string,
    readonly rollbackUserMessage: boolean,
    readonly invalidateChat: boolean,
  ) {
    super(message)
  }
}

const parseStreamError = async (response: Response) => {
  try {
    const payload = await response.json()
    if (payload?.error) {
      return payload.error as string
    }
  } catch {
  }

  return "Failed to analyze text"
}

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
          messages: [],
        })

        await queryClient.invalidateQueries({ queryKey: ["chat-history"] })
      }

      if (!activeChatId) {
        throw new Error("Chat session could not be created")
      }

      const optimisticUserId = crypto.randomUUID()
      const streamingAssistantId = crypto.randomUUID()

      const optimisticUserMessage: Message = {
        id: optimisticUserId,
        role: "user",
        content,
        createdAt: new Date(),
      }

      const streamingAssistantMessage: Message = {
        id: streamingAssistantId,
        role: "assistant",
        content: "",
        createdAt: new Date(),
        isStreaming: true,
        streamingProgress: {
          model: selectedModel,
          processedChunks: 0,
          totalChunks: 0,
        },
      }

      queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
        if (!old) {
          return undefined
        }

        return {
          ...old,
          messages: [...old.messages, optimisticUserMessage, streamingAssistantMessage],
        }
      })

      let shouldRollbackUserMessage = true
      let shouldInvalidateChat = false

      try {
        const response = await fetch("/api/chat/analyze/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chatId: activeChatId,
            content,
            model: selectedModel,
          }),
        })

        if (!response.ok) {
          throw new StreamingChatError(await parseStreamError(response), true, false)
        }

        if (!response.body) {
          throw new StreamingChatError("Streaming response body was not available", false, true)
        }

        shouldRollbackUserMessage = false
        shouldInvalidateChat = true

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let finalMessage: Message | null = null

        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.trim()) {
              continue
            }

            const event = JSON.parse(line) as StreamEvent

            if (event.type === "started") {
              queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                if (!old) {
                  return undefined
                }

                return {
                  ...old,
                  messages: old.messages.map((message) =>
                    message.id === streamingAssistantId
                      ? {
                          ...message,
                          streamingProgress: {
                            model: selectedModel,
                            processedChunks: 0,
                            totalChunks: event.totalChunks,
                          },
                        }
                      : message,
                  ),
                }
              })
              continue
            }

            if (event.type === "progress") {
              queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                if (!old) {
                  return undefined
                }

                return {
                  ...old,
                  messages: old.messages.map((message) =>
                    message.id === streamingAssistantId
                      ? {
                          ...message,
                          streamingProgress: {
                            model: selectedModel,
                            processedChunks: event.processedChunks,
                            totalChunks: event.totalChunks,
                          },
                        }
                      : message,
                  ),
                }
              })
              continue
            }

            if (event.type === "error") {
              throw new StreamingChatError(event.error, false, true)
            }

            if (event.type === "final") {
              finalMessage = {
                ...event.message,
                createdAt: new Date(event.message.createdAt),
              }

              queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                if (!old) {
                  return undefined
                }

                return {
                  ...old,
                  messages: old.messages.map((message) =>
                    message.id === streamingAssistantId ? finalMessage! : message,
                  ),
                }
              })
            }
          }
        }

        if (!finalMessage) {
          throw new StreamingChatError("Analysis completed without a final result", false, true)
        }

        return finalMessage
      } catch (error) {
        const failure =
          error instanceof StreamingChatError
            ? error
            : new StreamingChatError(
                error instanceof Error ? error.message : "Failed to analyze text",
                shouldRollbackUserMessage,
                shouldInvalidateChat,
              )

        queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
          if (!old) {
            return undefined
          }

          return {
            ...old,
            messages: old.messages.filter((message) => {
              if (message.id === streamingAssistantId) {
                return false
              }

              if (failure.rollbackUserMessage && message.id === optimisticUserId) {
                return false
              }

              return true
            }),
          }
        })

        if (failure.invalidateChat) {
          await queryClient.invalidateQueries({ queryKey: ["chat", activeChatId] })
        }

        throw failure
      }
    },
    onSuccess: async () => {
      useChatUIStore.getState().setRateLimited(false)

      const activeChatId = useChatUIStore.getState().currentChatId
      if (activeChatId) {
        await queryClient.invalidateQueries({ queryKey: ["chat", activeChatId] })
      }
    },
    onError: (error) => {
      console.error("Failed to send message", error)
      if (error instanceof Error && (error.message.includes("Rate limit") || error.message.includes("429"))) {
        useChatUIStore.getState().setRateLimited(true)
        toast.error("Rate limit exceeded")
      } else {
        toast.error(error instanceof Error ? error.message : "Failed to send message")
      }
    },
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
        old?.filter(c => c.id !== chatId) || [],
      )

      if (currentChatId === chatId) {
        setCurrentChatId(null)
        router.push("/chat")
      }
      toast.success("Chat deleted")
    },
    onError: () => toast.error("Failed to delete chat"),
  })

  const renameChat = useMutation({
    mutationFn: async ({ id, title }: { id: string, title: string }) => {
      const result = await renameChatAction(id, title)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (updatedChat) => {
      queryClient.setQueryData<ChatHistoryItem[]>(["chat-history"], (old) =>
        old?.map(c => c.id === updatedChat.id ? updatedChat : c) || [],
      )
      queryClient.invalidateQueries({ queryKey: ["chat", updatedChat.id] })
      toast.success("Chat renamed")
    },
    onError: () => toast.error("Failed to rename chat"),
  })

  return { deleteChat, renameChat }
}
