import { NextRequest, NextResponse } from "next/server"
import { validateTurnstileToken } from "@/features/auth/services/turnstile.server"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token } = body

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Turnstile token is required" },
        { status: 400 }
      )
    }

    const isValid = await validateTurnstileToken(token)

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid Turnstile token" },
        { status: 401 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error("Turnstile API Error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}