import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { z } from "zod"
import { authOptions } from "@/lib/config/auth-options"
import { MAX_LIVE_ANALYSIS_CHARS } from "@/features/chat/constants"
import { analysisOrchestrator } from "@/features/chat/services/analysis-orchestrator"
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

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 })
    }

    const { content } = parsed.data
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

    const stream = await analysisOrchestrator.execute({
      ...parsed.data,
      userId: session.user.id,
    }, request.signal)

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    )
  }
}
