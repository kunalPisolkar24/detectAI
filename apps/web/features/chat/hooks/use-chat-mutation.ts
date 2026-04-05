import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createChatAction, deleteChatAction, renameChatAction } from "@/features/chat/actions/chat"
import { useChatUIStore } from "../stores/ui-store"
import { Message, ChatSession, ChatHistoryItem, ModelType, StreamingAnalysisProgress } from "../types"
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

interface RetryAnalysisInput {
  assistantMessageId: string
  content: string
  model: ModelType
}

type AnalysisExecutionInput =
  | { kind: "new"; content: string }
  | ({ kind: "retry" } & RetryAnalysisInput)

class StreamingChatError extends Error {
  constructor(
    message: string,
    readonly kind: "cancelled" | "failed",
    readonly rollbackUserMessage: boolean,
    readonly invalidateChat: boolean,
    readonly retainAssistantMessage: boolean,
  ) {
    super(message)
  }
}

const isAbortError = (error: unknown) =>
  (error instanceof DOMException && error.name === "AbortError") ||
  (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")

const createStreamingProgress = (
  model: ModelType,
  retryContent: string,
  overrides: Partial<StreamingAnalysisProgress> = {},
): StreamingAnalysisProgress => ({
  model,
  processedChunks: 0,
  totalChunks: 0,
  status: "running",
  retryContent,
  ...overrides,
})

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
  const currentChatId = useChatUIStore((state) => state.currentChatId)
  const selectedModel = useChatUIStore((state) => state.selectedModel)
  const setCurrentChatId = useChatUIStore((state) => state.setCurrentChatId)
  const registerActiveAnalysis = useChatUIStore((state) => state.registerActiveAnalysis)
  const clearActiveAnalysis = useChatUIStore((state) => state.clearActiveAnalysis)
  const cancelActiveAnalysis = useChatUIStore((state) => state.cancelActiveAnalysis)
  const activeAnalysisMessageId = useChatUIStore((state) => state.activeAnalysisMessageId)
  const isCancelling = useChatUIStore((state) => state.isCancellingAnalysis)

  const mutation = useMutation({
    mutationFn: async (input: AnalysisExecutionInput) => {
      if (useChatUIStore.getState().activeAnalysisMessageId) {
        throw new Error("An analysis is already running")
      }

      let activeChatId = currentChatId
      const effectiveModel = input.kind === "retry" ? input.model : selectedModel

      if (input.kind === "new" && !activeChatId) {
        const createResult = await createChatAction(input.content)

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

      const optimisticUserId = input.kind === "new" ? crypto.randomUUID() : null
      const streamingAssistantId = input.kind === "retry" ? input.assistantMessageId : crypto.randomUUID()
      const controller = new AbortController()

      if (input.kind === "new") {
        const optimisticUserMessage: Message = {
          id: optimisticUserId!,
          role: "user",
          content: input.content,
          createdAt: new Date(),
        }

        const streamingAssistantMessage: Message = {
          id: streamingAssistantId,
          role: "assistant",
          content: "",
          createdAt: new Date(),
          isStreaming: true,
          streamingProgress: createStreamingProgress(effectiveModel, input.content),
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
      } else {
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
                    analysis: undefined,
                    content: "",
                    isStreaming: true,
                    streamingProgress: createStreamingProgress(effectiveModel, input.content),
                  }
                : message,
            ),
          }
        })
      }

      registerActiveAnalysis(streamingAssistantId, () => controller.abort())

      let shouldRollbackUserMessage = input.kind === "new"
      let shouldRetainAssistantMessage = input.kind === "retry"
      try {
        const response = await fetch("/api/chat/analyze/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            chatId: activeChatId,
            content: input.content,
            model: effectiveModel,
          }),
        })

        if (!response.ok) {
          throw new StreamingChatError(
            await parseStreamError(response),
            "failed",
            input.kind === "new",
            false,
            input.kind === "retry",
          )
        }

        if (!response.body) {
          throw new StreamingChatError("Streaming response body was not available", "failed", false, false, true)
        }

        shouldRollbackUserMessage = false
        shouldRetainAssistantMessage = true

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
                          isStreaming: true,
                          streamingProgress: {
                            model: effectiveModel,
                            processedChunks: 0,
                            totalChunks: event.totalChunks,
                            status: "running",
                            retryContent: input.content,
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
                          isStreaming: true,
                          streamingProgress: {
                            model: effectiveModel,
                            processedChunks: event.processedChunks,
                            totalChunks: event.totalChunks,
                            status: "running",
                            retryContent: input.content,
                          },
                        }
                      : message,
                  ),
                }
              })
              continue
            }

            if (event.type === "error") {
              throw new StreamingChatError(event.error, "failed", false, false, true)
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
          throw new StreamingChatError("Analysis completed without a final result", "failed", false, false, true)
        }

        return finalMessage
      } catch (error) {
        const failure =
          isAbortError(error)
            ? new StreamingChatError("Analysis canceled", "cancelled", false, false, true)
            : error instanceof StreamingChatError
            ? error
            : new StreamingChatError(
                error instanceof Error ? error.message : "Failed to analyze text",
                "failed",
                shouldRollbackUserMessage,
                false,
                shouldRetainAssistantMessage,
              )

        queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
          if (!old) {
            return undefined
          }

          if (!failure.retainAssistantMessage) {
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
          }

          return {
            ...old,
            messages: old.messages.flatMap((message) => {
              if (failure.rollbackUserMessage && message.id === optimisticUserId) {
                return []
              }

              if (message.id !== streamingAssistantId) {
                return [message]
              }

              const previousProgress = message.streamingProgress ?? createStreamingProgress(effectiveModel, input.content)

              return [{
                ...message,
                analysis: undefined,
                content: "",
                isStreaming: false,
                streamingProgress: {
                  ...previousProgress,
                  model: effectiveModel,
                  retryContent: input.content,
                  status: failure.kind,
                  error: failure.kind === "failed" ? failure.message : undefined,
                },
              }]
            }),
          }
        })

        if (failure.invalidateChat) {
          await queryClient.invalidateQueries({ queryKey: ["chat", activeChatId] })
        }

        throw failure
      } finally {
        clearActiveAnalysis(streamingAssistantId)
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
      if (error instanceof StreamingChatError && error.kind === "cancelled") {
        return
      }

      if (error instanceof Error && (error.message.includes("Rate limit") || error.message.includes("429"))) {
        useChatUIStore.getState().setRateLimited(true)
        toast.error("Rate limit exceeded")
      } else {
        toast.error(error instanceof Error ? error.message : "Failed to send message")
      }
    },
  })

  return {
    sendMessage: (content: string) => mutation.mutate({ kind: "new", content }),
    retryAnalysis: (input: RetryAnalysisInput) => mutation.mutate({ kind: "retry", ...input }),
    cancelActiveAnalysis,
    isAnalyzing: Boolean(activeAnalysisMessageId),
    isCancelling,
    activeAnalysisMessageId,
  }
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
