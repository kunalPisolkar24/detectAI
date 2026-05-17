import { useCallback, useMemo, useState } from "react"
import { env } from "@/lib/config/env"

const PLACEHOLDER_SITE_KEYS = new Set(["dummy"])

const ERROR_MESSAGES: Record<string, string> = {
  expired: "Verification expired. Retry to continue.",
  timeout: "Verification timed out. Retry to continue.",
  unsupported: "Your browser could not load human verification.",
  config: "Human verification is unavailable right now.",
}

export const useTurnstile = () => {
  const [token, setToken] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY.trim()
  const isConfigured = siteKey.length > 0 && !PLACEHOLDER_SITE_KEYS.has(siteKey)

  const reset = useCallback(() => {
    setToken(null)
    setErrorCode(null)
    setKey((prev) => prev + 1)
  }, [])

  const onVerify = useCallback((newToken: string) => {
    setToken(newToken)
    setErrorCode(null)
  }, [])

  const onError = useCallback((error: string) => {
    setToken(null)
    setErrorCode(error || "unknown")
    console.error("Turnstile client error:", error || "unknown")
  }, [])

  const onExpire = useCallback(() => {
    setToken(null)
    setErrorCode("expired")
  }, [])

  const onTimeout = useCallback(() => {
    setToken(null)
    setErrorCode("timeout")
  }, [])

  const errorMessage = useMemo(() => {
    if (!isConfigured) {
      return ERROR_MESSAGES.config
    }

    if (!errorCode) {
      return null
    }

    return ERROR_MESSAGES[errorCode] ?? "Verification failed. Retry to continue."
  }, [errorCode, isConfigured])

  return {
    token,
    key,
    siteKey,
    isConfigured,
    errorCode,
    errorMessage,
    onVerify,
    onError,
    onExpire,
    onTimeout,
    reset,
  }
}
