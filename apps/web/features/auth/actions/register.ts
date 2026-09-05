"use server"

import { z } from "zod"
import bcrypt from "bcryptjs"
import { SignupSchema } from "@/schemas/auth"
import { userService } from "@/features/auth/services/user-service"
import { validateTurnstileToken } from "@/features/auth/services/turnstile.server"

type RegisterActionState = {
  success?: boolean
  error?: string
}

export async function registerAction(
  values: z.infer<typeof SignupSchema>,
  turnstileToken: string | null
): Promise<RegisterActionState> {
  try {
    const validatedFields = SignupSchema.safeParse(values)

    if (!validatedFields.success) {
      return { error: "Invalid input fields" }
    }

    if (!turnstileToken) {
      return { error: "Please complete the captcha verification" }
    }

    const isHuman = await validateTurnstileToken(turnstileToken)
    if (!isHuman) {
      return { error: "Security check failed. Please try again." }
    }

    if (process.env.NEXT_PUBLIC_PREVIEW_MODE === "true") {
      // In preview, any signup succeeds without DB
      return { success: true }
    }

    const { email, password, firstName, lastName } = validatedFields.data

    const existingUser = await userService.getUserByEmail(email)
    if (existingUser) {
      return { error: "Email already in use" }
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    await userService.createUser({
      name: `${firstName} ${lastName}`,
      email,
      password: hashedPassword,
      firstName,
      lastName,
    })

    return { success: true }
  } catch (error) {
    console.error("Registration error:", error)
    return { error: "Something went wrong. Please try again." }
  }
}