"use client"

import { useMutation } from "@tanstack/react-query"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

import { AUTH_ERROR_MESSAGES } from "@/features/auth/constants"

type CredentialsAuthValues = {
  email: string
  password: string
  confirmPassword?: string
  firstName?: string
  lastName?: string
  turnstileToken: string
}

export function useCredentialsAuth(intent: "login" | "signup") {
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: async (values: CredentialsAuthValues) => {
      const result = await signIn("credentials", {
        ...values,
        intent,
        redirect: false,
      })

      if (!result?.ok) {
        throw new Error(AUTH_ERROR_MESSAGES[result?.code ?? ""] ?? AUTH_ERROR_MESSAGES.unknown)
      }

      return result
    },
    retry: false,
    onSuccess: () => {
      router.replace("/")
    },
  })

  return {
    submit: mutation.mutate,
    isPending: mutation.isPending,
    errorMessage: mutation.error?.message ?? null,
  }
}
