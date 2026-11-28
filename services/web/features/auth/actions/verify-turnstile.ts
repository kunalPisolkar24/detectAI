"use server"

import { TurnstileVerifyRequestSchema } from "@/features/auth/schemas/turnstile"
import { env } from "@/lib/config/env"

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const TIMEOUT_MS = 5000

interface SiteverifyResponse {
  success: boolean
  "error-codes"?: string[]
}

export async function verifyTurnstileAction(token: string): Promise<{ verified: boolean }> {
  const parsed = TurnstileVerifyRequestSchema.safeParse({ token })

  if (!parsed.success) {
    return { verified: false }
  }

  try {
    const { secretKey } = env.turnstile
    const body = new FormData()
    body.append("secret", secretKey)
    body.append("response", parsed.data.token)

    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      console.error("Turnstile verification unavailable", response.status)
      return { verified: false }
    }

    const outcome = (await response.json()) as SiteverifyResponse

    if (!outcome.success) {
      console.warn("Turnstile rejected token", outcome["error-codes"] ?? [])
    }

    return { verified: outcome.success }
  } catch (error) {
    console.error("Turnstile verification failed", error)
    return { verified: false }
  }
}
