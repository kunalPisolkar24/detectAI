import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Liveness probe — process is up. No dependency checks.
 * Used by Docker healthcheck, K8s livenessProbe, and monitoring.
 * Always 200 unless the process is dead.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store, private" } },
  )
}
