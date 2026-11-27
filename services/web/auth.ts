import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"

import { authenticate } from "@/features/auth/services/auth"

const isProd = process.env.NEXT_PUBLIC_ENV_TYPE === "prod"

type TokenUser = {
  id?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub,
    Google,
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
  secret: process.env.AUTH_SECRET ?? (isProd ? undefined : "dev-auth-secret-not-for-production-32chars"),
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
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
