"use client"

import { useCallback, useMemo, useState } from "react"

import { getPublicAuthEnv } from "@/lib/config/auth-env"
import {
  AUTH_COPY,
  PLACEHOLDER_SITE_KEYS,
  TURNSTILE_ERROR_MESSAGES,
} from "@/features/auth/constants"

export const useTurnstile = () => {
  const [token, setToken] = useState<string | null>(null)
  const [key, setKey] = useState(0)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const siteKey = getPublicAuthEnv().siteKey.trim()
  const isConfigured = siteKey.length > 0 && !PLACEHOLDER_SITE_KEYS.has(siteKey)

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
