import { getUsersServiceEnv } from "@/lib/config/users-env"

type UsersServiceUser = {
  id: string
  email: string
  name?: string
  firstName?: string
  lastName?: string
  image?: string
  emailVerified?: boolean
  createdAt?: string
}

type AuthTokens = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: UsersServiceUser
}

type WireAuthTokens = Omit<AuthTokens, "expiresIn"> & { expiresIn: string | number }

export class UsersServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "UsersServiceError"
  }
}

const AUTH_PROCEDURES = "/users.v1.AuthService"

async function call<T>(procedure: string, body: object): Promise<T> {
  const { url, apiKey } = getUsersServiceEnv()

  const response = await fetch(`${url.replace(/\/$/, "")}${procedure}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      code?: string
      message?: string
    } | null
    throw new UsersServiceError(
      payload?.code ?? "unknown",
      payload?.message ?? `users service returned ${response.status}`,
    )
  }

  return (await response.json()) as T
}

function toAuthTokens(wire: WireAuthTokens): AuthTokens {
  return { ...wire, expiresIn: Number(wire.expiresIn) }
}

export function register(input: {
  email: string
  password: string
  firstName: string
  lastName: string
}): Promise<UsersServiceUser> {
  return call<UsersServiceUser>(`${AUTH_PROCEDURES}/Register`, {
    email: input.email,
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
  })
}

export async function login(input: {
  email: string
  password: string
}): Promise<AuthTokens> {
  const wire = await call<WireAuthTokens>(`${AUTH_PROCEDURES}/Login`, {
    email: input.email,
    password: input.password,
  })
  return toAuthTokens(wire)
}
