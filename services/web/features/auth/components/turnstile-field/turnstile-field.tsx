"use client"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { TurnstileWidget } from "@/components/ui/turnstile"
import { AUTH_COPY } from "@/features/auth/constants"
import type { TurnstileState } from "@/features/auth/hooks/use-turnstile"

interface TurnstileFieldProps {
  turnstile: TurnstileState
}

export function TurnstileField({ turnstile }: TurnstileFieldProps) {
  const {
    key,
    siteKey,
    isConfigured,
    errorMessage,
    onVerify,
    onError,
    onExpire,
    onTimeout,
    reset,
  } = turnstile

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {isConfigured ? (
        <TurnstileWidget
          key={key}
          siteKey={siteKey}
          onVerify={onVerify}
          onError={onError}
          onExpire={onExpire}
          onTimeout={onTimeout}
        />
      ) : (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      {errorMessage && isConfigured ? (
        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-center text-sm text-destructive">{errorMessage}</p>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            {AUTH_COPY.turnstile.retry}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
