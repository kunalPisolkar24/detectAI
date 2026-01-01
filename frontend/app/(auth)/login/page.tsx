import { LoginForm } from "@/features/auth/components/login-form"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Login | Detect AI",
  description: "Sign in to your account",
}

export default function LoginPage() {
  return <LoginForm />
}