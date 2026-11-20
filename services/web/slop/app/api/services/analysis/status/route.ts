import { NextResponse } from "next/server"
import { isPreviewMode } from "@/lib/config/preview"

export const dynamic = "force-dynamic"

type AnalysisStatus = {
  status: "ok" | "skipped" | "error"
  latencyMs?: number
  error?: string
  checks?: { inference: AnalysisStatus; chatService: AnalysisStatus }
}

// Per-replica 15s cache so N clients share one pair of gRPC probes.
let cached: { at: number; body: AnalysisStatus & { cachedAt: number } } | null = null
const CACHE_TTL_MS = 15_000

async function checkAnalysis(): Promise<AnalysisStatus> {
  if (isPreviewMode()) return { status: "skipped" }

  const { checkGrpcHealth } = await import("@/lib/infrastructure/service-health")
  const { env } = await import("@/lib/config/env")

  const [inference, chatService] = await Promise.all([
    checkGrpcHealth(env.AI_SERVICE_URL, "aidetection.AIService").then((r) =>
      r.ok ? { status: "ok" as const, latencyMs: r.latencyMs } : { status: "error" as const, error: r.error },
    ),
    checkGrpcHealth(env.CHAT_SERVICE_URL, "chat.ChatService").then((r) =>
      r.ok ? { status: "ok" as const, latencyMs: r.latencyMs } : { status: "error" as const, error: r.error },
    ),
  ])

  const ok = inference.status === "ok" && chatService.status === "ok"
  if (ok) {
    const latencyMs = Math.max(inference.latencyMs ?? 0, chatService.latencyMs ?? 0)
    return { status: "ok", latencyMs, checks: { inference, chatService } }
  }
  const err = inference.status === "error" ? inference.error : chatService.error
  return { status: "error", error: err, checks: { inference, chatService } }
}

/**
 * Analysis status for the submit button (inference + chat service).
 * NOT for K8s readiness gating — readyz already reports degraded.
 * Client polls this (30s) instead of full /api/readyz to avoid extra DB checks.
 */
export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "Cache-Control": "no-store, private" } })
  }

  const result = await checkAnalysis()
  const body = { ...result, cachedAt: now }
  cached = { at: now, body }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, private" } })
}
