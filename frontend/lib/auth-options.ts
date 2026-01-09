import { NextAuthOptions, Profile } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GithubProvider from "next-auth/providers/github"
import GoogleProvider from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { SubscriptionStatus } from "@/lib/generated/prisma/client"
import { LoginSchema } from "@/schemas/auth"
import { env } from "@/lib/env"
import { userService } from "@/features/auth/services/user-service"

interface ExtendedProfile extends Profile {
  firstName?: string
  lastName?: string
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GithubProvider({
      clientId: env.GITHUB_ID,
      clientSecret: env.GITHUB_SECRET,
      allowDangerousEmailAccountLinking: false,
      profile(profile) {
        return {
          id: profile.id.toString(),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          firstName: profile.name?.split(" ")[0] ?? null,
          lastName: profile.name?.split(" ").slice(1).join(" ") ?? null,
        }
      },
    }),
    GoogleProvider({
      clientId: env.GOOGLE_ID,
      clientSecret: env.GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
          firstName: profile.given_name,
          lastName: profile.family_name,
        }
      },
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }
        const loginValidated = LoginSchema.safeParse(credentials)
        if (!loginValidated.success) {
          return null
        }
        const { email, password } = loginValidated.data
        const user = await prisma.user.findUnique({ where: { email } })
        if (!user || !user.password) {
          return null
        }
        const passwordsMatch = await bcrypt.compare(password, user.password)
        if (!passwordsMatch) {
          return null
        }
        const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE
        return {
          id: user.id,
          name: user.name ?? undefined,
          email: user.email,
          firstName: user.firstName ?? undefined,
          lastName: user.lastName ?? undefined,
          image: user.image ?? undefined,
          isPremium,
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  secret: env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        token.isPremium = user.isPremium ?? false
      }

      if (token.id) {
        try {
          const dbUser = await userService.getUserById(token.id)

          if (dbUser) {
            token.name = dbUser.name ?? token.name
            token.email = dbUser.email ?? token.email
            token.picture = dbUser.image ?? token.picture
            token.isPremium = dbUser.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE
          }
        } catch (error) {
          console.error("JWT Callback error:", error)
        }
      }

      if (trigger === "update" && session) {
        if (typeof session.name === "string") token.name = session.name
        if (typeof session.picture === "string") token.picture = session.picture
        if (typeof session.isPremium === "boolean") token.isPremium = session.isPremium
      }

      return token
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id
        session.user.name = token.name
        session.user.email = token.email
        session.user.image = token.picture
        session.user.isPremium = token.isPremium
      }
      return session
    },
  },
  events: {
    async linkAccount(message) {
      if (!message.user.id) return

      const user = await prisma.user.findUnique({ where: { id: message.user.id } })
      const profileData = message.profile as ExtendedProfile

      if (user && profileData) {
        const dataToUpdate: Record<string, string | null> = {}
        if (!user.firstName && profileData.firstName) dataToUpdate.firstName = profileData.firstName
        if (!user.lastName && profileData.lastName) dataToUpdate.lastName = profileData.lastName
        if (!user.name && profileData.name) dataToUpdate.name = profileData.name
        if (!user.image && profileData.image) dataToUpdate.image = profileData.image

        if (Object.keys(dataToUpdate).length > 0) {
          try {
            await userService.updateUser(user.id, dataToUpdate)
          } catch (error) {
            console.error("LinkAccount event error:", error)
          }
        }
      }
    },
  },
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
  debug: env.NODE_ENV === "development",
}