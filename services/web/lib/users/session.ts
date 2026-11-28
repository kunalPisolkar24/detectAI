import { getToken } from "next-auth/jwt"

import { unstable_update } from "@/auth"
import { env } from "@/lib/config/env"
import { refresh, UsersServiceError } from "@/lib/users/client"

const REFRESH_SKEW_MS = 30_000

export type SessionTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export type AccessResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number }

export async function readSessionTokens(request: Request): Promise<SessionTokens | null> {
  const token = await getToken({ req: request, secret: env.auth.secret })

  if (
    !token ||
    typeof token.accessToken !== "string" ||
    typeof token.refreshToken !== "string" ||
    typeof token.expiresAt !== "number"
  ) {
    return null
  }

  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
  }
}

async function rotateAndPersist(refreshToken: string): Promise<SessionTokens> {
  const rotated = await refresh(refreshToken)
  const tokens: SessionTokens = {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
    expiresAt: Date.now() + rotated.expiresIn * 1000,
  }
  await unstable_update(tokens)
  return tokens
}

export async function withFreshAccessToken<T>(
  tokens: SessionTokens,
  call: (accessToken: string) => Promise<T>,
): Promise<AccessResult<T>> {
  let current = tokens

  if (Date.now() >= current.expiresAt - REFRESH_SKEW_MS) {
    try {
      current = await rotateAndPersist(current.refreshToken)
    } catch (error) {
      console.error("access token refresh failed", error)
      return { ok: false, status: 401 }
    }
  }

  try {
    return { ok: true, value: await call(current.accessToken) }
  } catch (error) {
    if (!(error instanceof UsersServiceError) || error.code !== "unauthenticated") {
      console.error("users service call failed", error)
      return { ok: false, status: 502 }
    }
  }

  try {
    current = await rotateAndPersist(current.refreshToken)
  } catch (error) {
    console.error("access token refresh after rejection failed", error)
    return { ok: false, status: 401 }
  }

  try {
    return { ok: true, value: await call(current.accessToken) }
  } catch (error) {
    console.error("users service call failed after refresh", error)
    return { ok: false, status: 401 }
  }
}
