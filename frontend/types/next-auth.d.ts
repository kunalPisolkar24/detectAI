import { DefaultSession, DefaultUser } from "next-auth"
import { JWT } from "next-auth/jwt"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      isPremium: boolean
      firstName?: string | null
      lastName?: string | null
    } & DefaultSession["user"]
  }

  interface User extends DefaultUser {
    firstName?: string | null
    lastName?: string | null
    paddleSubscriptionStatus?: string | null
    isPremium?: boolean
  }

  interface Profile {
    login?: string
    avatar_url?: string
    picture?: string
    given_name?: string
    family_name?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    isPremium: boolean
    firstName?: string | null
    lastName?: string | null
  }
}