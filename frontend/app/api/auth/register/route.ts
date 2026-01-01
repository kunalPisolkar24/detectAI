import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { userService } from "@/features/auth/services/user-service"
import { validateTurnstileToken } from "@/features/auth/services/turnstile.server"

const userSchema = z.object({
  firstName: z.string().min(1, { message: "First Name required" }),
  lastName: z.string().min(1, { message: "Last Name required" }),
  email: z.string().email({ message: "Invalid email" }),
  password: z.string().min(8, { message: "Password must be at least 8 chars" }),
  turnstileToken: z.string().optional(), 
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validationResult = userSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { email, password, firstName, lastName, turnstileToken } = validationResult.data

    if (turnstileToken) {
      const isValid = await validateTurnstileToken(turnstileToken)
      if (!isValid) {
        return NextResponse.json({ error: "Invalid captcha" }, { status: 401 })
      }
    }

    const existingUser = await userService.getUserByEmail(email)

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newUser = await userService.createUser({
      name: `${firstName} ${lastName}`,
      email,
      password: hashedPassword,
      firstName,
      lastName,
    })

    return NextResponse.json(
      {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}