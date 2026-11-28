import { env } from "@/lib/config/env"
import { ConnectError, createConnectClient } from "@/lib/connect/client"

export type UsersServiceUser = {
  id: string
  email: string
  name?: string
  firstName?: string
  lastName?: string
  image?: string
  emailVerified?: boolean
  createdAt?: string
}

export type AuthTokens = {
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
const USER_PROCEDURES = "/users.v1.UserService"

const client = createConnectClient({
  baseUrl: env.users.url,
  headers: { "x-api-key": env.users.apiKey },
})

async function call<T>(
  procedure: string,
  body: object,
  headers: Record<string, string> = {},
): Promise<T> {
  try {
    return await client.call<T>(procedure, body, headers)
  } catch (error) {
    if (error instanceof ConnectError) {
      throw new UsersServiceError(error.code, error.message)
    }
    throw error
  }
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

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const wire = await call<WireAuthTokens>(
    `${AUTH_PROCEDURES}/Refresh`,
    {},
    { "X-Refresh-Token": refreshToken },
  )
  return toAuthTokens(wire)
}

export function getMe(accessToken: string): Promise<UsersServiceUser> {
  return call<UsersServiceUser>(`${USER_PROCEDURES}/GetMe`, {}, {
    Authorization: `Bearer ${accessToken}`,
  })
}
