import "server-only"
import { env } from "@/lib/config/env"

interface TurnstileResponse {
  success: boolean
  "error-codes"?: string[]
  challenge_ts?: string
  hostname?: string
}

export async function validateTurnstileToken(token: string): Promise<boolean> {
  // Preview: accept any non-empty token without Cloudflare round-trip (covers test keys and offline)
  if (process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
    return !!token
  }
  const secretKey = env.TURNSTILE_SECRET_KEY

  const formData = new FormData()
  formData.append("secret", secretKey)
  formData.append("response", token)

  try {
    const result = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: formData,
        method: "POST",
      }
    )

    const outcome: TurnstileResponse = await result.json()
    return outcome.success
  } catch (error) {
    console.error("Cloudflare Turnstile verification failed:", error)
    return false
  }
}