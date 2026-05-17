import { env } from "@/lib/config/env"
import { registry } from "@/lib/infrastructure/metrics"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const token = env.PROMETHEUS_WEB_SCRAPE_TOKEN
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  try {
    const metrics = await registry.metrics()
    return new NextResponse(metrics, {
      headers: {
        "Content-Type": registry.contentType,
        "Cache-Control": "no-store, private",
      },
    })
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}
