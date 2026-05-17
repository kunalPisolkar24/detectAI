"use client"

import { Turnstile, TurnstileInstance } from "@marsidev/react-turnstile"
import { useTheme } from "next-themes"
import { useRef } from "react"

interface TurnstileComponentProps {
  siteKey: string
  onVerify: (token: string) => void
  onError?: (error: string) => void
  onExpire?: () => void
  onTimeout?: () => void
}

export function TurnstileComponent({
  siteKey,
  onVerify,
  onError,
  onExpire,
  onTimeout,
}: TurnstileComponentProps) {
  const turnstileRef = useRef<TurnstileInstance>(null)
  const { theme } = useTheme()

  const handleSuccess = (token: string) => {
    onVerify(token)
  }

  const handleError = (error: string) => {
    if (onError) {
      onError(error)
    }
  }

  return (
    <Turnstile
      ref={turnstileRef}
      siteKey={siteKey}
      onSuccess={handleSuccess}
      onError={handleError}
      onExpire={onExpire}
      onTimeout={onTimeout}
      options={{
        theme: theme === "dark" ? "dark" : "light",
        size: "normal",
        retry: "never",
        refreshExpired: "manual",
        refreshTimeout: "manual",
      }}
    />
  )
}
