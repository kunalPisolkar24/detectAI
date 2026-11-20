import NextAuth from "next-auth"
import { NextResponse, type NextRequest } from "next/server"
import { authOptions } from "@/lib/config/auth-options"

const handler = NextAuth(authOptions)

type RouteContext = { params: Promise<{ nextauth: string[] }> }

/**
 * NextAuth reads the request body itself, and a malformed one escapes as a
 * 500. A body it cannot read is a client error, so it is refused here
 * first - the same contract the analyze route offers for a bad payload.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const contentType = request.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    try {
      JSON.parse(await request.clone().text())
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
  }

  return handler(request, context)
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handler(request, context)
}
