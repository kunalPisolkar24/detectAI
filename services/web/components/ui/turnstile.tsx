"use client"

import { Turnstile } from "@marsidev/react-turnstile"
import { useTheme } from "next-themes"

interface TurnstileWidgetProps {
  siteKey: string
  onVerify: (token: string) => void
  onError?: (error: string) => void
  onExpire?: () => void
  onTimeout?: () => void
}

export function TurnstileWidget({
  siteKey,
  onVerify,
  onError,
  onExpire,
  onTimeout,
}: TurnstileWidgetProps) {
  const { resolvedTheme } = useTheme()

  return (
    <Turnstile
      siteKey={siteKey}
      onSuccess={onVerify}
      onError={onError}
      onExpire={onExpire}
      onTimeout={onTimeout}
      options={{
        theme: resolvedTheme === "dark" ? "dark" : "light",
        size: "normal",
        retry: "never",
        refreshExpired: "manual",
        refreshTimeout: "manual",
      }}
    />
  )
}
