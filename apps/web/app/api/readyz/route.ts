import { NextResponse } from "next/server"
import { isPreviewMode } from "@/lib/config/preview"

export const dynamic = "force-dynamic"

type CheckResult = { status: "ok" | "skipped" | "error"; latencyMs?: number; error?: string }

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkPostgres(): Promise<CheckResult> {
  const start = performance.now()
  try {
    // Lazy import so preview proxy never tries to create pools at eval time.
    const { prisma } = await import("@/lib/infrastructure/prisma")
    const ok = await withTimeout(
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      2000,
      false,
    )
    if (!ok) return { status: "error", error: "query failed or timed out" }
    return { status: "ok", latencyMs: Math.round(performance.now() - start) }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = performance.now()
  try {
    const { redisWriter } = await import("@/lib/infrastructure/redis")
    const ok = await withTimeout(
      (async () => {
        try {
          const res = await redisWriter.ping()
          return res === "PONG" || (redisWriter.status === "ready")
        } catch {
          return false
        }
      })(),
      2000,
      false,
    )
    if (!ok) return { status: "error", error: "ping failed or timed out" }
    return { status: "ok", latencyMs: Math.round(performance.now() - start) }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkDocumentParser(): Promise<CheckResult> {
  if (isPreviewMode()) return { status: "skipped" }
  const start = performance.now()
  try {
    const { env } = await import("@/lib/config/env")
    const url = `${env.FILE_EXTRACTOR_API_URL.replace(/\/$/, "")}/health`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
      if (!res.ok) return { status: "error", error: `health ${res.status}` }
      return { status: "ok", latencyMs: Math.round(performance.now() - start) }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkPaymentGateway(): Promise<CheckResult> {
  if (isPreviewMode()) return { status: "skipped" }
  const start = performance.now()
  try {
    const { env } = await import("@/lib/config/env")
    const url = `${env.PAYMENT_GATEWAY_URL.replace(/\/$/, "")}/readyz`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
      if (!res.ok) return { status: "error", error: `readyz ${res.status}` }
      return { status: "ok", latencyMs: Math.round(performance.now() - start) }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkAnalysis(): Promise<CheckResult & { checks?: { inference: CheckResult; chatService: CheckResult } }> {
  if (isPreviewMode()) return { status: "skipped" }
  try {
    const { checkGrpcHealth } = await import("@/lib/infrastructure/service-health")
    const { env } = await import("@/lib/config/env")
    const [inferenceRes, chatRes] = await Promise.all([
      checkGrpcHealth(env.AI_SERVICE_URL, "aidetection.AIService"),
      checkGrpcHealth(env.CHAT_SERVICE_URL, "chat.ChatService"),
    ])
    const inference: CheckResult = inferenceRes.ok
      ? { status: "ok", latencyMs: inferenceRes.latencyMs }
      : { status: "error", error: inferenceRes.error }
    const chatService: CheckResult = chatRes.ok
      ? { status: "ok", latencyMs: chatRes.latencyMs }
      : { status: "error", error: chatRes.error }
    const ok = inference.status === "ok" && chatService.status === "ok"
    return ok
      ? { status: "ok", checks: { inference, chatService } }
      : { status: "error", error: inference.status === "error" ? inference.error : chatService.error, checks: { inference, chatService } }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Readiness probe — postgres + redis are required; document parser, payment
 * gateway, and analysis (inference+chat) are optional (degraded, not 503 —
 * core routes still work). In preview mode all are skipped. Returns 200
 * when required checks pass, 503 when any required check fails.
 */
export async function GET() {
  if (isPreviewMode()) {
    return NextResponse.json(
      {
        status: "ready",
        mode: "preview",
        checks: {
          postgres: { status: "skipped" },
          redis: { status: "skipped" },
          documentParser: { status: "skipped" },
          paymentGateway: { status: "skipped" },
          analysis: { status: "skipped" },
        },
      },
      { headers: { "Cache-Control": "no-store, private" } },
    )
  }

  const [postgres, redis, documentParser, paymentGateway, analysis] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkDocumentParser(),
    checkPaymentGateway(),
    checkAnalysis(),
  ])
  const ready = postgres.status === "ok" && redis.status === "ok"
  const degraded =
    documentParser.status === "error" || paymentGateway.status === "error" || analysis.status === "error"
  const status = ready ? (degraded ? "degraded" : "ready") : "not_ready"

  return NextResponse.json(
    { status, checks: { postgres, redis, documentParser, paymentGateway, analysis } },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store, private" },
    },
  )
}
