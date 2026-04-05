import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"

import { authOptions } from "@/lib/auth-options"
import { MAX_LIVE_ANALYSIS_CHARS } from "@/features/chat/constants"
import { chatService } from "@/features/chat/services"
import { inferenceService, InferenceStreamAbortedError } from "@/features/chat/services/inference-service"
import { AnalysisResult } from "@/features/chat/types"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"

export const runtime = "nodejs"

const requestSchema = z.object({
  chatId: z.string().min(1),
  content: z.string().min(1),
  model: z.enum(["spark", "flare"]),
})

const encoder = new TextEncoder()

const toStreamLine = (payload: unknown) => encoder.encode(`${JSON.stringify(payload)}\n`)

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

  const { chatId, content, model } = parsed.data
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

  try {
    await chatService.saveUserMessage(chatId, session.user.id, content)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save user message",
      },
      { status: 500 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let finalAnalysis: AnalysisResult | null = null
      let closed = false
      let aborted = request.signal.aborted

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
          enqueue({ type: "error", error: "Analysis did not produce a final result" })
          return
        }

        const assistantMessage = await chatService.saveAssistantAnalysis(chatId, session.user.id, finalAnalysis)

        if (aborted) {
          return
        }

        await rateLimitService.trackUsage(session.user.id)

        enqueue({
          type: "final",
          message: {
            ...assistantMessage,
            createdAt: assistantMessage.createdAt.toISOString(),
          },
        })
      } catch (error) {
        if (!aborted && !(error instanceof InferenceStreamAbortedError)) {
          enqueue({
            type: "error",
            error: error instanceof Error ? error.message : "Failed to analyze text",
          })
        }
      } finally {
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
