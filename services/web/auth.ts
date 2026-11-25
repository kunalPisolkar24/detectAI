import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"

const isProd = process.env.NEXT_PUBLIC_ENV_TYPE === "prod"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub,
    Google,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: () => null,
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET ?? (isProd ? undefined : "dev-auth-secret-not-for-production-32chars"),
  pages: { signIn: "/login" },
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub
      }
      return session
    },
  },
})
