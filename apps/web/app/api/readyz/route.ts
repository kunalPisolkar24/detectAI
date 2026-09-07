import { NextResponse } from "next/server"
import { isPreviewMode } from "@/lib/config/preview"

export const dynamic = "force-dynamic"

type CheckResult = { status: "ok" | "skipped" | "error"; latencyMs?: number; error?: string }

// Cache postgres/redis results for 10s to avoid 10s cold-start on every probe
let pgCache: { at: number; result: CheckResult } | null = null
let redisCache: { at: number; result: CheckResult } | null = null
const PG_REDIS_TTL_MS = 10_000

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
  const now = Date.now()
  if (pgCache && now - pgCache.at < PG_REDIS_TTL_MS) return pgCache.result
  const start = performance.now()
  let pool: import("pg").Pool | null = null
  try {
    const { Pool } = await import("pg")
    const { env } = await import("@/lib/config/env")
    if (!env.DATABASE_URL) return { status: "error", error: "DATABASE_URL not set" }
    pool = new Pool({ connectionString: env.DATABASE_URL })
    const result = await pool.query("SELECT 1")
    const res: CheckResult = { status: "ok", latencyMs: Math.round(performance.now() - start) }
    pgCache = { at: Date.now(), result: res }
    return res
  } catch (err) {
    console.error("checkPostgres error:", err instanceof Error ? err.message : err)
    const result: CheckResult = { status: "error", error: err instanceof Error ? err.message : String(err) }
    pgCache = { at: Date.now(), result }
    return result
  } finally {
    try {
      await pool?.end()
    } catch {}
  }
}

async function checkRedis(): Promise<CheckResult> {
  const now = Date.now()
  if (redisCache && now - redisCache.at < PG_REDIS_TTL_MS) return redisCache.result
  const start = performance.now()
  let client: import("ioredis").Redis | null = null
  try {
    const Redis = (await import("ioredis")).default
    const { env } = await import("@/lib/config/env")
    if (!env.REDIS_URL) return { status: "error", error: "REDIS_URL not set" }
    client = new Redis(env.REDIS_URL)
    const res = await client.ping()
    if (res !== "PONG") {
      const result: CheckResult = { status: "error", error: "ping failed" }
      redisCache = { at: Date.now(), result }
      return result
    }
    const result: CheckResult = { status: "ok", latencyMs: Math.round(performance.now() - start) }
    redisCache = { at: Date.now(), result }
    return result
  } catch (err) {
    console.error("checkRedis error:", err instanceof Error ? err.message : err)
    const result: CheckResult = { status: "error", error: err instanceof Error ? err.message : String(err) }
    redisCache = { at: Date.now(), result }
    return result
  } finally {
    try {
      await client?.quit()
    } catch {}
    try {
      client?.disconnect()
    } catch {}
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
