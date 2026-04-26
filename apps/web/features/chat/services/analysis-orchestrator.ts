import { IChatService } from "./chat-service.interface"
import { chatService as defaultChatService } from "./index"
import { inferenceService as defaultInferenceService, InferenceStreamAbortedError } from "./inference-service"
import { AnalysisResult, Message, ModelType } from "../types"
import { rateLimitService as defaultRateLimitService } from "@/features/rate-limit/services/rate-limit-service"
import { createNDJSONStream } from "@/lib/utils/stream-utils"

export interface AnalysisParams {
  chatId: string
  userId: string
  content: string
  model: ModelType
  assistantMessageId?: string
  assistantCreatedAt?: string
  sourceMessageId?: string
}

export class AnalysisOrchestrator {
  constructor(
    private chatService: IChatService = defaultChatService,
    private inferenceService = defaultInferenceService,
    private rateLimitService = defaultRateLimitService
  ) {}

  async execute(params: AnalysisParams, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const isRetry = Boolean(params.assistantMessageId)
    
    let persistedAssistantMessage: Message
    let persistedSourceMessageId: string

    if (isRetry) {
      persistedSourceMessageId = params.sourceMessageId!
      persistedAssistantMessage = await this.chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
        messageId: params.assistantMessageId,
        createdAt: new Date(params.assistantCreatedAt!),
        state: "running",
        model: params.model,
        sourceMessageId: persistedSourceMessageId,
      })
    } else {
      const userMessage = await this.chatService.saveUserMessage(params.chatId, params.userId, params.content)
      persistedSourceMessageId = userMessage.id
      persistedAssistantMessage = await this.chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
        state: "running",
        model: params.model,
        sourceMessageId: persistedSourceMessageId,
      })
    }

    const serialize = (message: Message) => ({
      ...message,
      createdAt: message.createdAt.toISOString()
    })

    return createNDJSONStream(async (enqueue) => {
      let finalAnalysis: AnalysisResult | null = null
      let terminalStatePersisted = false
      let finalized = false

      enqueue({
        type: "accepted",
        message: serialize(persistedAssistantMessage)
      })

      try {
        await this.inferenceService.streamDocument(params.content, params.model, {
          signal,
          onEvent: (event) => {
            if (signal.aborted) return
            if (event.type === "final") {
              finalAnalysis = event.result
              return
            }
            enqueue(event)
          }
        })

        if (signal.aborted) return

        if (!finalAnalysis) {
          throw new Error("Analysis did not produce a final result")
        }

        const assistantMessage = await this.chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
          messageId: persistedAssistantMessage.id,
          createdAt: persistedAssistantMessage.createdAt,
          state: "completed",
          model: params.model,
          sourceMessageId: persistedSourceMessageId,
          analysis: finalAnalysis,
        })
        
        terminalStatePersisted = true
        finalized = true

        try {
          await this.rateLimitService.trackUsage(params.userId)
        } catch {
        }

        enqueue({
          type: "final",
          message: serialize(assistantMessage)
        })
      } catch (error) {
        const status = signal.aborted || error instanceof InferenceStreamAbortedError ? "cancelled" : "failed"
        const errorMessage = error instanceof Error ? error.message : "Analysis failed"

        try {
          await this.chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
            messageId: persistedAssistantMessage.id,
            createdAt: persistedAssistantMessage.createdAt,
            state: status,
            model: params.model,
            sourceMessageId: persistedSourceMessageId,
            error: status === "failed" ? errorMessage : undefined,
          })
          terminalStatePersisted = true
        } catch {
        }

        if (!signal.aborted && !(error instanceof InferenceStreamAbortedError)) {
          enqueue({ type: "error", error: errorMessage })
        }
      } finally {
        if (signal.aborted && !finalized && !terminalStatePersisted) {
          try {
            await this.chatService.saveAssistantAnalysisMessage(params.chatId, params.userId, {
              messageId: persistedAssistantMessage.id,
              createdAt: persistedAssistantMessage.createdAt,
              state: "cancelled",
              model: params.model,
              sourceMessageId: persistedSourceMessageId,
            })
          } catch {
          }
        }
      }
    })
  }
}

export const analysisOrchestrator = new AnalysisOrchestrator()
