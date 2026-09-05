import { createNDJSONStream } from "@/lib/utils/stream-utils"
import { generateMockAnalysis, mockStreamDocument } from "@/features/preview/lib/mock-inference"
import type { AnalysisParams } from "@/features/chat/services/analysis-orchestrator"
import { chatService } from "@/features/chat/services"

export async function createPreviewStream(params: AnalysisParams, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const isRetry = Boolean(params.assistantMessageId)
  let persistedAssistantMessage
  let persistedSourceMessageId: string

  if (isRetry) {
    persistedSourceMessageId = params.sourceMessageId!
    persistedAssistantMessage = await chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
      messageId: params.assistantMessageId,
      createdAt: new Date(params.assistantCreatedAt!),
      state: "running",
      model: params.model,
      sourceMessageId: persistedSourceMessageId,
    })
  } else {
    const userMessage = await chatService.saveUserMessage(params.chatId, params.userId, params.content)
    persistedSourceMessageId = userMessage.id
    persistedAssistantMessage = await chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
      state: "running",
      model: params.model,
      sourceMessageId: persistedSourceMessageId,
    })
  }

  const serialize = (message: typeof persistedAssistantMessage) => ({
    ...message,
    createdAt: message.createdAt.toISOString(),
  })

  return createNDJSONStream(async (enqueue) => {
    let finalAnalysis: ReturnType<typeof generateMockAnalysis> | null = null
    let terminalStatePersisted = false
    let finalized = false

    enqueue({ type: "accepted", message: serialize(persistedAssistantMessage) })

    try {
      await mockStreamDocument(params.content, params.model, {
        signal,
        onEvent: (event) => {
          if (signal.aborted) return
          if (event.type === "final") {
            finalAnalysis = event.result
            return
          }
          enqueue(event)
        },
      })

      if (signal.aborted) return

      if (!finalAnalysis) {
        throw new Error("Analysis did not produce a final result")
      }

      const assistantMessage = await chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
        messageId: persistedAssistantMessage.id,
        createdAt: persistedAssistantMessage.createdAt,
        state: "completed",
        model: params.model,
        sourceMessageId: persistedSourceMessageId,
        analysis: finalAnalysis,
      })

      terminalStatePersisted = true
      finalized = true

      enqueue({ type: "final", message: serialize(assistantMessage) })
    } catch (error) {
      const isCancelled = signal.aborted || (error instanceof DOMException && error.name === "AbortError")
      const status = isCancelled ? "cancelled" : "failed"
      const errorMessage = error instanceof Error ? error.message : "Analysis failed"

      try {
        await chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
          messageId: persistedAssistantMessage.id,
          createdAt: persistedAssistantMessage.createdAt,
          state: status,
          model: params.model,
          sourceMessageId: persistedSourceMessageId,
          error: status === "failed" ? errorMessage : undefined,
        })
        terminalStatePersisted = true
      } catch {}

      if (!signal.aborted && status === "failed") {
        enqueue({ type: "error", error: errorMessage })
      }
    } finally {
      if (signal.aborted && !finalized && !terminalStatePersisted) {
        try {
          await chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
            messageId: persistedAssistantMessage.id,
            createdAt: persistedAssistantMessage.createdAt,
            state: "cancelled",
            model: params.model,
            sourceMessageId: persistedSourceMessageId,
          })
        } catch {}
      }
    }
  })
}
