import { CredentialsSignin } from "next-auth"

import { verifyTurnstileAction } from "@/features/auth/actions/verify-turnstile"
import {
  LoginSchema,
  SignupSchema,
  type LoginValues,
  type SignupValues,
} from "@/features/auth/schemas/auth"
import { login, register, UsersServiceError } from "@/lib/users/client"

export type AuthCredentials = {
  email?: unknown
  password?: unknown
  confirmPassword?: unknown
  firstName?: unknown
  lastName?: unknown
  intent?: unknown
  turnstileToken?: unknown
}

export type AuthenticatedUser = {
  id: string
  email: string
  name: string
  image?: string | null
  accessToken: string
  refreshToken: string
  expiresAt: number
}

function fail(code: string): never {
  throw Object.assign(new CredentialsSignin(), { code })
}

function serviceFailure(error: unknown, registration: boolean): never {
  if (error instanceof UsersServiceError) {
    if (registration && error.code === "already_exists") fail("email_taken")
    if (!registration && (error.code === "unauthenticated" || error.code === "invalid_argument")) {
      fail("invalid_credentials")
    }
  }
  console.error("users service authentication failed", error)
  fail("service_unavailable")
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function parseCredentials(credentials: AuthCredentials, registration: boolean): SignupValues | LoginValues {
  if (registration) {
    const parsed = SignupSchema.safeParse({
      email: credentials.email,
      password: credentials.password,
      confirmPassword: credentials.confirmPassword,
      firstName: credentials.firstName,
      lastName: credentials.lastName,
    })
    if (!parsed.success) fail("invalid_credentials")
    return parsed.data
  }

  const parsed = LoginSchema.safeParse({
    email: credentials.email,
    password: credentials.password,
  })
  if (!parsed.success) fail("invalid_credentials")
  return parsed.data
}

async function exchange(
  values: SignupValues | LoginValues,
  registration: boolean,
  turnstileToken: string,
): Promise<AuthenticatedUser> {
  const { verified } = await verifyTurnstileAction(turnstileToken)
  if (!verified) fail("captcha_failed")

  const email = values.email.trim().toLowerCase()

  if (registration && "firstName" in values && "lastName" in values) {
    await register({
      email,
      password: values.password,
      firstName: values.firstName,
      lastName: values.lastName,
    }).catch((error: unknown) => serviceFailure(error, true))
  }

  const tokens = await login({ email, password: values.password }).catch((error: unknown) =>
    serviceFailure(error, false),
  )

  const name =
    tokens.user.name?.trim() ||
    [tokens.user.firstName, tokens.user.lastName].filter(Boolean).join(" ").trim() ||
    email

  return {
    id: tokens.user.id,
    email: tokens.user.email,
    name,
    image: tokens.user.image ?? null,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  }
}

export async function authenticate(credentials: AuthCredentials): Promise<AuthenticatedUser> {
  const registration = credentials.intent === "signup"
  const values = parseCredentials(credentials, registration)
  return exchange(values, registration, asText(credentials.turnstileToken))
}
