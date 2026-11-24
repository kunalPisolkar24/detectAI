import type { Metadata } from "next"

import { LoginForm } from "@/features/auth/components/login"

export const metadata: Metadata = {
  title: "Log in | Detect AI",
  description: "Sign in to your account",
}

export default function LoginPage() {
  return <LoginForm />
}
