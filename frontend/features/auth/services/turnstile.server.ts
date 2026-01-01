import "server-only"

interface TurnstileResponse {
  success: boolean
  "error-codes"?: string[]
  challenge_ts?: string
  hostname?: string
}

export async function validateTurnstileToken(token: string): Promise<boolean> {
  let secretKey = process.env.TURNSTILE_SECRET_KEY
  const isDev = process.env.NODE_ENV === "development"

  if (isDev && (!secretKey || secretKey === "1x0000000000000000000000000000000AA")) {
    secretKey = "1x0000000000000000000000000000000AA"
  }

  if (!secretKey) {
    throw new Error("TURNSTILE_SECRET_KEY is not defined")
  }

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