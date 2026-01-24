import { registry } from "@/lib/metrics"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const metrics = await registry.metrics()
    return new NextResponse(metrics, {
      headers: {
        "Content-Type": registry.contentType,
      },
    })
  } catch (error) {
    return new NextResponse("Internal Server Error", { status: 500 })
  }
}