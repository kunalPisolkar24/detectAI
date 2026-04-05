import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"

import { authOptions } from "@/lib/auth-options"
import { MAX_LIVE_ANALYSIS_CHARS } from "@/features/chat/constants"
import { chatService } from "@/features/chat/services"
import { inferenceService, InferenceStreamAbortedError } from "@/features/chat/services/inference-service"
import { AnalysisResult, Message } from "@/features/chat/types"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"

export const runtime = "nodejs"

const requestSchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
  model: z.enum(["spark", "flare"]),
  assistantMessageId: z.string().min(1).optional(),
  assistantCreatedAt: z.string().datetime().optional(),
  sourceMessageId: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  const hasRetryFields = Boolean(value.assistantMessageId || value.assistantCreatedAt || value.sourceMessageId)

  if (!hasRetryFields) {
    return
  }

  if (!value.assistantMessageId || !value.assistantCreatedAt || !value.sourceMessageId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Retry requests must include assistant message details",
    })
  }
})

const encoder = new TextEncoder()

const toStreamLine = (payload: unknown) => encoder.encode(`${JSON.stringify(payload)}\n`)
const serializeMessage = (message: Message) => ({
  ...message,
  createdAt: message.createdAt.toISOString(),
})

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
  }

  const {
    chatId,
    content,
    model,
    assistantMessageId,
    assistantCreatedAt,
    sourceMessageId,
  } = parsed.data
  const isRetry = Boolean(assistantMessageId)
  if (content.length > MAX_LIVE_ANALYSIS_CHARS) {
    return NextResponse.json(
      { error: `Text exceeds maximum length of ${MAX_LIVE_ANALYSIS_CHARS} characters` },
      { status: 400 },
    )
  }

  const { allowed } = await rateLimitService.checkLimit(session.user.id, session.user.isPremium ?? false)
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  let persistedAssistantMessage: Message
  let persistedSourceMessageId: string

  try {
    if (isRetry) {
      persistedSourceMessageId = sourceMessageId!
      persistedAssistantMessage = await chatService.saveAssistantAnalysisMessage(chatId, session.user.id, {
        messageId: assistantMessageId,
        createdAt: new Date(assistantCreatedAt!),
        state: "running",
        model,
        sourceMessageId: persistedSourceMessageId,
      })
    } else {
      const userMessage = await chatService.saveUserMessage(chatId, session.user.id, content)
      persistedSourceMessageId = userMessage.id
      persistedAssistantMessage = await chatService.saveAssistantAnalysisMessage(chatId, session.user.id, {
        state: "running",
        model,
        sourceMessageId: persistedSourceMessageId,
      })
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to initialize analysis",
      },
      { status: 500 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finalAnalysis: AnalysisResult | null = null
      let closed = false
      let aborted = request.signal.aborted
      let finalized = false
      let terminalStatePersisted = false

      const closeStream = () => {
        if (closed) {
          return
        }

        closed = true

        try {
          controller.close()
        } catch {
        }
      }

      const enqueue = (payload: unknown) => {
        if (aborted || closed) {
          return
        }

        controller.enqueue(toStreamLine(payload))
      }

      const handleAbort = () => {
        aborted = true
      }

      request.signal.addEventListener("abort", handleAbort, { once: true })
      enqueue({
        type: "accepted",
        message: serializeMessage(persistedAssistantMessage),
      })

      try {
        await inferenceService.streamDocument(content, model, {
          signal: request.signal,
          onEvent: (event) => {
            if (aborted) {
              return
            }

            if (event.type === "final") {
              finalAnalysis = event.result
              return
            }

            enqueue(event)
          },
        })

        if (aborted) {
          return
        }

        if (!finalAnalysis) {
          throw new Error("Analysis did not produce a final result")
        }

        const assistantMessage = await chatService.saveAssistantAnalysisMessage(chatId, session.user.id, {
          messageId: persistedAssistantMessage.id,
          createdAt: persistedAssistantMessage.createdAt,
          state: "completed",
          model,
          sourceMessageId: persistedSourceMessageId,
          analysis: finalAnalysis,
        })
        terminalStatePersisted = true
        finalized = true

        if (aborted) {
          return
        }

        try {
          await rateLimitService.trackUsage(session.user.id)
        } catch {
        }

        enqueue({
          type: "final",
          message: serializeMessage(assistantMessage),
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to analyze text"
        const status = aborted || error instanceof InferenceStreamAbortedError ? "cancelled" : "failed"

        try {
          await chatService.saveAssistantAnalysisMessage(chatId, session.user.id, {
            messageId: persistedAssistantMessage.id,
            createdAt: persistedAssistantMessage.createdAt,
            state: status,
            model,
            sourceMessageId: persistedSourceMessageId,
            error: status === "failed" ? errorMessage : undefined,
          })
          terminalStatePersisted = true
        } catch {
        }

        if (!aborted && !(error instanceof InferenceStreamAbortedError)) {
          enqueue({
            type: "error",
            error: errorMessage,
          })
        }
      } finally {
        if (aborted && !finalized && !terminalStatePersisted) {
          try {
            await chatService.saveAssistantAnalysisMessage(chatId, session.user.id, {
              messageId: persistedAssistantMessage.id,
              createdAt: persistedAssistantMessage.createdAt,
              state: "cancelled",
              model,
              sourceMessageId: persistedSourceMessageId,
            })
            terminalStatePersisted = true
          } catch {
          }
        }

        request.signal.removeEventListener("abort", handleAbort)
        closeStream()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
