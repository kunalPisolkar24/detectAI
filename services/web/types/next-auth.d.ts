import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]

    // Cookie-only fields passed to unstable_update; never copied into the client session.
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
  }
}
