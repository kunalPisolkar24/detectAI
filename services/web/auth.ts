import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"

import { authenticate } from "@/features/auth/services/auth"
import { env } from "@/lib/config/env"

type TokenUser = {
  id?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  providers: [
    GitHub({ clientId: env.auth.github.id, clientSecret: env.auth.github.secret }),
    Google({ clientId: env.auth.google.id, clientSecret: env.auth.google.secret }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        confirmPassword: { label: "Confirm Password", type: "password" },
        firstName: { label: "First Name" },
        lastName: { label: "Last Name" },
        intent: { label: "Intent" },
        turnstileToken: { label: "Turnstile token" },
      },
      authorize: (credentials) => authenticate(credentials),
    }),
  ],
  session: { strategy: "jwt" },
  secret: env.auth.secret,
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user, session }) {
      if (session && typeof session === "object") {
        const update = session as {
          accessToken?: unknown
          refreshToken?: unknown
          expiresAt?: unknown
        }
        if (typeof update.accessToken === "string") token.accessToken = update.accessToken
        if (typeof update.refreshToken === "string") token.refreshToken = update.refreshToken
        if (typeof update.expiresAt === "number") token.expiresAt = update.expiresAt
      }

      const credentialUser = user as TokenUser | undefined
      if (credentialUser?.accessToken && credentialUser.refreshToken && credentialUser.expiresAt) {
        token.accessToken = credentialUser.accessToken
        token.refreshToken = credentialUser.refreshToken
        token.expiresAt = credentialUser.expiresAt
      }
      return token
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
})
