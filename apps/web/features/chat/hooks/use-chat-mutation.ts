import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createChatAction, deleteChatAction, renameChatAction } from "@/features/chat/actions/chat"
import { useChatUIStore } from "../stores/ui-store"
import { Message, ChatSession, ChatHistoryItem, ModelType, StreamingAnalysisProgress } from "../types"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { isPreviewModeClient } from "@/lib/config/preview"

interface SerializedMessage extends Omit<Message, "createdAt"> {
  createdAt: string
}

type StreamEvent =
  | { type: "accepted"; message: SerializedMessage }
  | { type: "started"; totalChars: number; totalChunks: number }
  | { type: "progress"; processedChunks: number; totalChunks: number }
  | { type: "final"; message: SerializedMessage }
  | { type: "error"; error: string }

interface RetryAnalysisInput {
  assistantMessageId: string
  assistantCreatedAt: Date
  sourceMessageId: string
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

const deserializeMessage = (message: SerializedMessage): Message => ({
  ...message,
  createdAt: new Date(message.createdAt),
})

export const useSendMessage = () => {
  const queryClient = useQueryClient()
  const currentChatId = useChatUIStore((state) => state.currentChatId)
  const selectedModel = useChatUIStore((state) => state.selectedModel)
  const setCurrentChatId = useChatUIStore((state) => state.setCurrentChatId)
  const registerActiveAnalysis = useChatUIStore((state) => state.registerActiveAnalysis)
  const updateActiveAnalysisMessageId = useChatUIStore((state) => state.updateActiveAnalysisMessageId)
  const clearActiveAnalysis = useChatUIStore((state) => state.clearActiveAnalysis)
  const cancelActiveAnalysis = useChatUIStore((state) => state.cancelActiveAnalysis)
  const activeAnalysisChatId = useChatUIStore((state) => state.activeAnalysisChatId)
  const activeAnalysisMessageId = useChatUIStore((state) => state.activeAnalysisMessageId)
  const isCancelling = useChatUIStore((state) => state.isCancellingAnalysis)

  const mutation = useMutation({
    mutationFn: async (input: AnalysisExecutionInput) => {
      if (useChatUIStore.getState().activeAnalysisChatId) {
        throw new Error("An analysis is already running")
      }

      const isPreview = isPreviewModeClient()

      let activeChatId = currentChatId
      const effectiveModel = input.kind === "retry" ? input.model : selectedModel

      if (input.kind === "new" && !activeChatId) {
        if (isPreview) {
          const { previewCreateChat } = await import("@/features/preview/lib/preview-db")
          const newChat = await previewCreateChat(input.content)
          activeChatId = newChat.id
          setCurrentChatId(activeChatId)
          queryClient.setQueryData<ChatSession>(["chat", activeChatId], {
            ...newChat,
            messages: [],
          })
          await queryClient.invalidateQueries({ queryKey: ["chat-history"] })
        } else {
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
      }

      if (!activeChatId) {
        throw new Error("Chat session could not be created")
      }

      const optimisticUserId = input.kind === "new" ? crypto.randomUUID() : null
      const streamingAssistantId = input.kind === "retry" ? input.assistantMessageId : crypto.randomUUID()
      const controller = new AbortController()
      let activeAssistantMessageId = streamingAssistantId

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
                    analysisStatus: message.analysisStatus
                      ? {
                          ...message.analysisStatus,
                          state: "running",
                          error: undefined,
                        }
                      : message.analysisStatus,
                    streamingProgress: createStreamingProgress(effectiveModel, input.content),
                  }
                : message,
            ),
          }
        })
      }

      registerActiveAnalysis({
        chatId: activeChatId,
        messageId: streamingAssistantId,
        cancel: () => controller.abort(),
      })

      let shouldRollbackUserMessage = input.kind === "new"
      let shouldRetainAssistantMessage = input.kind === "retry"
      try {
        if (isPreview) {
          if (input.kind === "new" && optimisticUserId) {
            const { previewPersistUserMessage, previewPersistAssistantRunning } = await import("@/features/preview/lib/preview-db")
            const now = new Date()
            await previewPersistUserMessage(activeChatId, optimisticUserId, input.content, now)
            await previewPersistAssistantRunning(activeChatId, streamingAssistantId, now, effectiveModel, optimisticUserId)
          } else if (input.kind === "retry") {
            const { previewSaveAssistantMessage } = await import("@/features/preview/lib/preview-db")
            await previewSaveAssistantMessage(activeChatId, {
              messageId: streamingAssistantId,
              state: "running",
              model: effectiveModel,
              sourceMessageId: input.sourceMessageId,
            })
          }
          shouldRollbackUserMessage = false
          shouldRetainAssistantMessage = true

          const { mockStreamDocument } = await import("@/features/preview/lib/mock-inference")
          const { previewPersistAssistantFinal } = await import("@/features/preview/lib/preview-db")
          let mockFinalAnalysis: import("@/features/chat/types").AnalysisResult | null = null

          await mockStreamDocument(input.content, effectiveModel, {
            signal: controller.signal,
            onEvent: (event) => {
              if (controller.signal.aborted) return
              if (event.type === "started") {
                queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                  if (!old) return undefined
                  return {
                    ...old,
                    messages: old.messages.map((message) =>
                      message.id === activeAssistantMessageId
                        ? {
                            ...message,
                            isStreaming: true,
                            streamingProgress: {
                              model: effectiveModel,
                              processedChunks: 0,
                              totalChunks: event.totalChunks,
                              status: "running",
                              retryContent: input.content,
                              sourceMessageId: message.analysisStatus?.sourceMessageId,
                            },
                          }
                        : message,
                    ),
                  }
                })
              } else if (event.type === "progress") {
                queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                  if (!old) return undefined
                  return {
                    ...old,
                    messages: old.messages.map((message) =>
                      message.id === activeAssistantMessageId
                        ? {
                            ...message,
                            isStreaming: true,
                            streamingProgress: {
                              model: effectiveModel,
                              processedChunks: event.processedChunks,
                              totalChunks: event.totalChunks,
                              status: "running",
                              retryContent: input.content,
                              sourceMessageId: message.analysisStatus?.sourceMessageId,
                            },
                          }
                        : message,
                    ),
                  }
                })
              } else if (event.type === "final") {
                mockFinalAnalysis = event.result
              }
            },
          })

          if (controller.signal.aborted) {
            throw new DOMException("Aborted", "AbortError")
          }

          if (!mockFinalAnalysis) {
            throw new Error("Analysis did not produce a final result")
          }

          const sourceId = input.kind === "retry" ? input.sourceMessageId : optimisticUserId!
          const finalPersisted = await previewPersistAssistantFinal(activeChatId, streamingAssistantId, mockFinalAnalysis, sourceId)
          const finalMessage: Message = {
            ...finalPersisted,
            isStreaming: false,
            streamingProgress: undefined,
          }

          queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
            if (!old) return undefined
            return {
              ...old,
              messages: old.messages.map((message) =>
                message.id === activeAssistantMessageId ? finalMessage : message,
              ),
            }
          })

          // Preview analytics: increment daily/total to replicate real trackUsage
          try {
            const { incrementPreviewUsage } = await import("@/features/preview/lib/preview-usage")
            incrementPreviewUsage()
          } catch {}

          // Also update chat history title if first message
          await queryClient.invalidateQueries({ queryKey: ["chat-history"] })

          return {
            chatId: activeChatId,
            message: finalMessage,
          }
        }

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
            assistantMessageId: input.kind === "retry" ? input.assistantMessageId : undefined,
            assistantCreatedAt: input.kind === "retry" ? input.assistantCreatedAt.toISOString() : undefined,
            sourceMessageId: input.kind === "retry" ? input.sourceMessageId : undefined,
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

            if (event.type === "accepted") {
              const acceptedMessage = deserializeMessage(event.message)
              activeAssistantMessageId = acceptedMessage.id
              updateActiveAnalysisMessageId(acceptedMessage.id)

              queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                if (!old) {
                  return undefined
                }

                return {
                  ...old,
                  messages: old.messages.map((message) =>
                    message.id === streamingAssistantId
                      ? {
                          ...acceptedMessage,
                          isStreaming: true,
                          streamingProgress: message.streamingProgress ?? createStreamingProgress(
                            effectiveModel,
                            input.content,
                            {
                              sourceMessageId: acceptedMessage.analysisStatus?.sourceMessageId,
                            },
                          ),
                        }
                      : message,
                  ),
                }
              })
              continue
            }

            if (event.type === "started") {
              queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                if (!old) {
                  return undefined
                }

                return {
                  ...old,
                  messages: old.messages.map((message) =>
                    message.id === activeAssistantMessageId
                      ? {
                          ...message,
                          isStreaming: true,
                          streamingProgress: {
                            model: effectiveModel,
                            processedChunks: 0,
                            totalChunks: event.totalChunks,
                            status: "running",
                            retryContent: input.content,
                            sourceMessageId: message.analysisStatus?.sourceMessageId,
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
                    message.id === activeAssistantMessageId
                      ? {
                          ...message,
                          isStreaming: true,
                          streamingProgress: {
                            model: effectiveModel,
                            processedChunks: event.processedChunks,
                            totalChunks: event.totalChunks,
                            status: "running",
                            retryContent: input.content,
                            sourceMessageId: message.analysisStatus?.sourceMessageId,
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
              finalMessage = deserializeMessage(event.message)

              queryClient.setQueryData<ChatSession>(["chat", activeChatId], (old) => {
                if (!old) {
                  return undefined
                }

                return {
                  ...old,
                  messages: old.messages.map((message) =>
                    message.id === activeAssistantMessageId ? finalMessage! : message,
                  ),
                }
              })
            }
          }
        }

        if (!finalMessage) {
          throw new StreamingChatError("Analysis completed without a final result", "failed", false, false, true)
        }

        return {
          chatId: activeChatId,
          message: finalMessage,
        }
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

        // Persist failure to IndexedDB in preview mode
        if (isPreview) {
          try {
            if (failure.rollbackUserMessage && optimisticUserId) {
              const { previewDeleteMessage } = await import("@/features/preview/lib/preview-db")
              await previewDeleteMessage(optimisticUserId)
              await previewDeleteMessage(activeAssistantMessageId)
            } else if (!failure.retainAssistantMessage) {
              const { previewDeleteMessage } = await import("@/features/preview/lib/preview-db")
              await previewDeleteMessage(activeAssistantMessageId)
            } else {
              const { previewPersistAssistantFailed } = await import("@/features/preview/lib/preview-db")
              const sourceId = input.kind === "retry" ? input.sourceMessageId : (optimisticUserId ?? "")
              await previewPersistAssistantFailed(activeChatId, activeAssistantMessageId, effectiveModel, sourceId, failure.message, failure.kind === "cancelled" ? "cancelled" : "failed")
            }
          } catch {}
        }

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

              if (message.id !== activeAssistantMessageId) {
                return [message]
              }

              const previousProgress = message.streamingProgress ?? createStreamingProgress(effectiveModel, input.content)

              return [{
                ...message,
                analysis: undefined,
                content: "",
                isStreaming: false,
                analysisStatus: message.analysisStatus
                  ? {
                      ...message.analysisStatus,
                      state: failure.kind,
                      error: failure.kind === "failed" ? failure.message : undefined,
                    }
                  : message.analysisStatus,
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
        clearActiveAnalysis()
      }
    },
    onSuccess: async (result) => {
      useChatUIStore.getState().setRateLimited(false)

      if (result?.chatId) {
        await queryClient.invalidateQueries({ queryKey: ["chat", result.chatId] })
      }
    },
    onError: (error) => {
      console.error("Failed to send message", error)
      if (error instanceof StreamingChatError && error.kind === "cancelled") {
        return
      }

      if (error instanceof Error && (error.message.includes("Rate limit") || error.message.includes("429"))) {
        useChatUIStore.getState().setRateLimited(true)
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
    activeAnalysisChatId,
    activeAnalysisMessageId,
  }
}

export const useChatMutations = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { currentChatId, setCurrentChatId } = useChatUIStore()

  const deleteChat = useMutation({
    mutationFn: async (chatId: string) => {
      if (isPreviewModeClient()) {
        const { previewDeleteChat } = await import("@/features/preview/lib/preview-db")
        await previewDeleteChat(chatId)
        return
      }
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
    },
    onError: () => toast.error("Failed to delete chat"),
  })

  const renameChat = useMutation({
    mutationFn: async ({ id, title }: { id: string, title: string }) => {
      if (isPreviewModeClient()) {
        const { previewRenameChat } = await import("@/features/preview/lib/preview-db")
        const updated = await previewRenameChat(id, title)
        return updated
      }
      const result = await renameChatAction(id, title)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: (updatedChat) => {
      if (!updatedChat) return
      queryClient.setQueryData<ChatHistoryItem[]>(["chat-history"], (old) =>
        old?.map(c => c.id === (updatedChat as ChatHistoryItem).id ? (updatedChat as ChatHistoryItem) : c) || [],
      )
      if (updatedChat) queryClient.invalidateQueries({ queryKey: ["chat", (updatedChat as ChatHistoryItem).id] })
    },
    onError: () => toast.error("Failed to rename chat"),
  })

  return { deleteChat, renameChat }
}
