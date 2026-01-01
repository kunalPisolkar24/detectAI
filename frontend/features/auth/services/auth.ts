import { z } from "zod"
import { SignupSchema } from "@/schemas/auth"

type RegisterData = z.infer<typeof SignupSchema>

export const verifyTurnstileToken = async (token: string): Promise<void> => {
  const response = await fetch("/api/verify-turnstile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || "Verification failed")
  }
}

export const registerUser = async (data: RegisterData): Promise<void> => {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      name: `${data.firstName} ${data.lastName}`,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || "Registration failed")
  }
}