import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { LoginSchema } from "@/schemas/auth-schema";
import prisma from "@/lib/prisma";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import { SubscriptionStatus, User as PrismaUser } from "@prisma/client";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID as string,
      clientSecret: process.env.GITHUB_SECRET as string,
      profile(profile) {
         return {
           id: profile.id.toString(),
           name: profile.name ?? profile.login,
           email: profile.email,
           image: profile.avatar_url,
           firstName: profile.name?.split(' ')[0],
           lastName: profile.name?.split(' ').slice(1).join(' '),
         }
      }
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_ID as string,
      clientSecret: process.env.GOOGLE_SECRET as string,
       profile(profile) {
         return {
           id: profile.sub,
           name: profile.name,
           email: profile.email,
           image: profile.picture,
           firstName: profile.given_name,
           lastName: profile.family_name,
         }
       }
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }
        const loginValidated = LoginSchema.safeParse(credentials);
        if (!loginValidated.success) { return null; }
        const { email, password } = loginValidated.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) { return null; }
        const passwordsMatch = await bcrypt.compare(password, user.password);
        if (!passwordsMatch) { return null; }
        const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE;
        return {
          id: user.id,
          name: user.name ?? undefined,
          email: user.email,
          firstName: user.firstName ?? undefined,
          lastName: user.lastName ?? undefined,
          image: user.image ?? undefined,
          isPremium: isPremium
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
     async jwt({ token, user, account, profile, isNewUser, trigger, session }) {
       if (user) {
         token.id = user.id;

         try {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: {
                    name: true,
                    email: true,
                    image: true,
                    paddleSubscriptionStatus: true,
                    firstName: true,
                    lastName: true,
                 }
            });

            if (dbUser) {
               token.name = dbUser.name ?? token.name;
               token.email = dbUser.email ?? token.email;
               token.picture = dbUser.image ?? token.picture;
               token.isPremium = dbUser.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE;
            } else {
               token.isPremium = false;
               console.warn(`JWT Callback: User with ID ${user.id} not found in DB during initial sign in.`);
            }
         } catch (error) {
             console.error("JWT Callback: Error fetching user from DB", error);
             token.isPremium = (user as any).isPremium ?? false;
         }
       }


       if (trigger === "update" && session) {
         console.log("Updating JWT token via trigger:", session);
         if (typeof session.name !== 'undefined') {
           token.name = session.name;
         }
         if (typeof session.picture !== 'undefined') {
           token.picture = session.picture;
         }
         if (typeof session.isPremium === 'boolean') {
            token.isPremium = session.isPremium;
            console.log("JWT token isPremium updated via trigger to:", token.isPremium);
         }
       }

       return token;
     },
     async session({ session, token }: any) {
       if (session.user) {
         session.user.id = token.id;
         session.user.name = token.name;
         session.user.email = token.email;
         session.user.image = token.picture;
         session.user.isPremium = token.isPremium;
       }
       return session;
     },
  },
  events: {
     async createUser(message) {
       console.log("User created (event):", message.user.id, message.user.email);
     },
     async linkAccount(message) {
        const user = await prisma.user.findUnique({ where: { id: message.user.id }});
        const profileData = message.profile as any;

        if (user && profileData) {
           const dataToUpdate: Partial<PrismaUser> = {};
           if (!user.firstName && profileData.firstName) dataToUpdate.firstName = profileData.firstName;
           if (!user.lastName && profileData.lastName) dataToUpdate.lastName = profileData.lastName;
           if (!user.name && profileData.name) dataToUpdate.name = profileData.name;
           if (!user.image && profileData.image) dataToUpdate.image = profileData.image;

           if (Object.keys(dataToUpdate).length > 0) {
             try {
                await prisma.user.update({ where: { id: user.id }, data: dataToUpdate });
                console.log(`Updated profile details for user ${user.id} from ${message.account.provider} via linkAccount event.`);
             } catch (error) {
                 console.error(`Error updating profile for user ${user.id} during linkAccount event:`, error);
             }
           }
        } else if (!profileData) {
            console.warn(`linkAccount event for user ${message.user.id} from ${message.account.provider} did not receive profile data.`);
        }
     }
  },
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
  debug: process.env.NODE_ENV === "development",
};