// import { NextAuthOptions } from "next-auth";
// import CredentialsProvider from "next-auth/providers/credentials";
// import GithubProvider from "next-auth/providers/github";
// import GoogleProvider from "next-auth/providers/google";
// import bcrypt from "bcrypt";
// import { LoginSchema } from "@/schemas/auth-schema";
// import prisma from "@/lib/prisma";
// import { PrismaAdapter } from "@next-auth/prisma-adapter";
// import type { Adapter } from "next-auth/adapters";

// export const authOptions: NextAuthOptions = {
//   adapter: PrismaAdapter(prisma) as Adapter,
//   providers: [
//     GithubProvider({
//       clientId: process.env.GITHUB_ID as string,
//       clientSecret: process.env.GITHUB_SECRET as string,
//     }),
//     GoogleProvider({
//       clientId: process.env.GOOGLE_ID as string,
//       clientSecret: process.env.GOOGLE_SECRET as string,
//     }),
//     CredentialsProvider({
//       name: "Credentials",
//       credentials: {
//         email: { label: "Email", type: "email" },
//         password: { label: "Password", type: "password" }
//       },
//       async authorize(credentials) {
//         if (!credentials?.email || !credentials?.password) {
//           return null;
//         }
        
//         // Validate login credentials
//         const loginValidated = LoginSchema.safeParse(credentials);
//         if (!loginValidated.success) {
//           return null;
//         }

//         const { email, password } = loginValidated.data;

//         const user = await prisma.user.findUnique({
//           where: { email },
//         });

//         if (!user || !user.password) {
//           return null;
//         }

//         const passwordsMatch = await bcrypt.compare(password, user.password);

//         if (!passwordsMatch) {
//           return null;
//         }

//         return {
//           id: user.id,
//           name: user.name,
//           email: user.email,
//         };
//       },
//     }),
//   ],
//   session: {
//     strategy: "jwt",
//   },
//   secret: process.env.NEXTAUTH_SECRET,
//   callbacks: {
//     async jwt({ token, user }) {
//       if (user) {
//         token.id = user.id;
//         token.name = user.name;
//         token.email = user.email;
//       }
//       return token;
//     },
//     async session({ session, token }: any) {
//       if (session?.user) {
//         session.user.id = token.id as string;
//       }
//       return session;
//     },
//   },
//   pages: {
//     signIn: "/login",
//     error: "/auth/error",
//   },
//   debug: process.env.NODE_ENV === "development",
// };

import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcrypt";
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
      // Add profile callback to potentially map GitHub data to firstName/lastName
      profile(profile) {
         return {
           id: profile.id.toString(),
           name: profile.name ?? profile.login,
           email: profile.email,
           image: profile.avatar_url,
           // Attempt to split name if available
           firstName: profile.name?.split(' ')[0],
           lastName: profile.name?.split(' ').slice(1).join(' '),
         }
      }
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_ID as string,
      clientSecret: process.env.GOOGLE_SECRET as string,
       // Add profile callback to map Google data
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
        if (!loginValidated.success) {
          return null;
        }

        const { email, password } = loginValidated.data;

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) {
          return null;
        }

        const passwordsMatch = await bcrypt.compare(password, user.password);

        if (!passwordsMatch) {
          return null;
        }

        const isPremium = user.paddleSubscriptionStatus === SubscriptionStatus.ACTIVE;

        // Map Prisma User to NextAuth User, ensuring null maps to undefined where needed
        return {
          id: user.id,
          name: user.name ?? undefined,
          email: user.email,
          firstName: user.firstName ?? undefined,
          lastName: user.lastName ?? undefined,
          image: user.image ?? undefined,
          isPremium: isPremium // Include premium status
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
     async jwt({ token, user, trigger, session }) {
      if (user) {
        // On sign in or registration, populate token with user data
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image;
        // Explicitly cast user to include isPremium if needed, or check if it exists
        token.isPremium = (user as { isPremium?: boolean }).isPremium ?? false;
      }
      return token;
    },
    async session({ session, token }: any) {
      // Pass data from the JWT token to the session object
      if (session.user) {
        session.user.id = token.id;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.image = token.picture;
        session.user.isPremium = token.isPremium; // Pass premium status
      }
      return session;
    },
  },
  events: {
     // Sync user data from OAuth providers on first sign in
     async createUser(message) {
       // If using OAuth and adapter, this might handle basic creation.
       // You might want to add custom logic here if needed upon first user creation.
       console.log("User created (event):", message.user.id, message.user.email);
     },
     async linkAccount(message) {
        // This event fires when an OAuth account is linked (e.g., first sign in)
        // Update user profile with details from the provider if missing
        const user = await prisma.user.findUnique({ where: { id: message.user.id }});
        if (user && message.profile) {
           const dataToUpdate: Partial<PrismaUser> = {};
           if (!user.firstName && message.profile.firstName) dataToUpdate.firstName = message.profile.firstName;
           if (!user.lastName && message.profile.lastName) dataToUpdate.lastName = message.profile.lastName;
           if (!user.name && message.profile.name) dataToUpdate.name = message.profile.name;
           if (!user.image && message.profile.image) dataToUpdate.image = message.profile.image;

           if (Object.keys(dataToUpdate).length > 0) {
             await prisma.user.update({
               where: { id: user.id },
               data: dataToUpdate
             });
             console.log(`Updated profile for user ${user.id} from ${message.account.provider}`);
           }
        }
     }
  },
  pages: {
    signIn: "/login",
    error: "/auth/error",
  },
  debug: process.env.NODE_ENV === "development",
};