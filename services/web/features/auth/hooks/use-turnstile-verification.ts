"use client"

import { useMutation } from "@tanstack/react-query"

import { verifyTurnstileAction } from "@/features/auth/actions/verify-turnstile"
import { AUTH_COPY } from "@/features/auth/constants"

export function useTurnstileVerification() {
  const mutation = useMutation({ mutationFn: verifyTurnstileAction })

  const verify = async (token: string) => {
    mutation.reset()
    try {
      const { verified } = await mutation.mutateAsync(token)
      return verified
    } catch {
      return false
    }
  }

  const errorMessage = mutation.isError
    ? AUTH_COPY.turnstile.config
    : mutation.data?.verified === false
      ? AUTH_COPY.turnstile.fallback
      : null

  return { verify, errorMessage, isPending: mutation.isPending }
}
