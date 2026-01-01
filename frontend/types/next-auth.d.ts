import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface User {
    id?: string;
    role?: string;
    firstName?: string;
    lastName?: string;
  }

  interface Session {
    user: {
      id?: string;
      role?: string;
      firstName?: string;
      lastName?: string;
    } & DefaultSession["user"]
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    firstName?: string;
    lastName?: string;
  }
}