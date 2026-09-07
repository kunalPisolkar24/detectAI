import { NextResponse } from "next/server"
import { isPreviewMode } from "@/lib/config/preview"

export const dynamic = "force-dynamic"

type GatewayStatus = { status: "ok" | "skipped" | "error"; latencyMs?: number; error?: string }

// 15s per-replica cache — mirrors document-parser status (N clients share one probe).
let cached: { at: number; body: GatewayStatus & { cachedAt: number } } | null = null
const CACHE_TTL_MS = 15_000

async function checkGateway(): Promise<GatewayStatus> {
  if (isPreviewMode()) return { status: "skipped" }

  const now = performance.now()
  try {
    const { env } = await import("@/lib/config/env")
    const url = `${env.PAYMENT_GATEWAY_URL.replace(/\/$/, "")}/readyz`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
      if (!res.ok) return { status: "error", error: `readyz ${res.status}` }
      return { status: "ok", latencyMs: Math.round(performance.now() - now) }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Payment-gateway status for upgrade/cancel buttons.
 * NOT for K8s readiness — upgrades can be retried later. Core routes stay up.
 * Client polls this (30s) instead of full /api/readyz to avoid N× postgres/redis checks.
 */
export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "Cache-Control": "no-store, private" } })
  }

  const result = await checkGateway()
  const body = { ...result, cachedAt: now }
  cached = { at: now, body }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, private" } })
}
