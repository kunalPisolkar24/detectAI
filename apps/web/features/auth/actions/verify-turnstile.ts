"use server"

import { validateTurnstileToken } from "@/features/auth/services/turnstile.server"

type ActionState = {
  success: boolean
  error?: string
}

export async function verifyTurnstileAction(token: string): Promise<ActionState> {
  if (!token) {
    return { success: false, error: "Token is missing" }
  }

  if (process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
    return { success: true }
  }

  const isValid = await validateTurnstileToken(token)

  if (!isValid) {
    return { success: false, error: "Invalid captcha" }
  }

  return { success: true }
}