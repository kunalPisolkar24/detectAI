import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Liveness probe — always 200 if process is alive.
export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store, private" } },
  )
}
