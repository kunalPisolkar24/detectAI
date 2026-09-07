import { NextResponse } from "next/server"
import { isPreviewMode } from "@/lib/config/preview"

export const dynamic = "force-dynamic"

type ParserStatus = { status: "ok" | "skipped" | "error"; latencyMs?: number; error?: string }

// Server-side in-memory cache: 15s so N concurrent clients share one upstream probe.
let cached: { at: number; body: ParserStatus & { status: ParserStatus["status"] extends string ? string : never } & { cachedAt: number } } | null = null
const CACHE_TTL_MS = 15_000

async function checkParser(): Promise<ParserStatus> {
  if (isPreviewMode()) return { status: "skipped" }

  const now = performance.now()
  try {
    const { env } = await import("@/lib/config/env")
    const url = `${env.FILE_EXTRACTOR_API_URL.replace(/\/$/, "")}/health`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" })
      if (!res.ok) return { status: "error", error: `health ${res.status}` }
      return { status: "ok", latencyMs: Math.round(performance.now() - now) }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // AbortError or fetch failure both mean parser is unreachable.
    return { status: "error", error: msg }
  }
}

/**
 * Lightweight parser status for the attachment button.
 * NOT used for K8s readiness — core paste-to-analyze works without the parser.
 * Client polls this (30s) instead of full /api/readyz to avoid N× postgres/redis checks.
 */
export async function GET() {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "Cache-Control": "no-store, private" } })
  }

  const result = await checkParser()
  const body = { ...result, cachedAt: now }

  // Cache both ok and error — error is the degraded case we want to debounce.
  cached = { at: now, body }

  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, private" } })
}
