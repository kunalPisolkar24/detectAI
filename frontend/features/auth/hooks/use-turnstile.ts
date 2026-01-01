import { useState, useCallback } from "react"

export const useTurnstile = () => {
  const [token, setToken] = useState<string | null>(null)
  const [key, setKey] = useState(0)

  const reset = useCallback(() => {
    setToken(null)
    setKey((prev) => prev + 1)
  }, [])

  const onVerify = useCallback((newToken: string) => {
    setToken(newToken)
  }, [])

  return {
    token,
    key,
    onVerify,
    reset,
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "",
  }
}