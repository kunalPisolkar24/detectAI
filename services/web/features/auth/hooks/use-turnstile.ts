"use client"

import { useCallback, useMemo, useState } from "react"

import { publicEnv } from "@/lib/config/public-env"
import { AUTH_COPY, TURNSTILE_ERROR_MESSAGES } from "@/features/auth/constants"

export const useTurnstile = () => {
  const [token, setToken] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const { siteKey } = publicEnv.turnstile
  const isConfigured = !publicEnv.turnstile.isTestKey

  const reset = useCallback(() => {
    setToken(null)
    setErrorCode(null)
    setKey((current) => current + 1)
  }, [])

  const onVerify = useCallback((newToken: string) => {
    setToken(newToken)
    setErrorCode(null)
  }, [])

  const onError = useCallback((error: string) => {
    setToken(null)
    setErrorCode(error || "unknown")
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
    if (!isConfigured) return AUTH_COPY.turnstile.config
    if (!errorCode) return null
    return TURNSTILE_ERROR_MESSAGES[errorCode] ?? AUTH_COPY.turnstile.fallback
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

export type TurnstileState = ReturnType<typeof useTurnstile>
