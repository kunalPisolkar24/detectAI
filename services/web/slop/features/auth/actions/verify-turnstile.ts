"use server"

import { validateTurnstileToken } from "@/features/auth/services/turnstile.server"
import { isPreviewMode } from "@/lib/config/preview"

type ActionState = {
  success: boolean
  error?: string
}

export async function verifyTurnstileAction(token: string): Promise<ActionState> {
  if (!token) {
    return { success: false, error: "Token is missing" }
  }

  if (isPreviewMode()) {
    return { success: true }
  }

  const isValid = await validateTurnstileToken(token)

  if (!isValid) {
    return { success: false, error: "Invalid captcha" }
  }

  return { success: true }
}