import { Suspense } from "react"
import type { Metadata } from "next"
import { LoginForm } from "@/features/auth/components/login-form"
import { AuthCardSkeleton } from "@/features/auth/components/auth-card-skeleton"

export const metadata: Metadata = {
  title: "Login | Detect AI",
  description: "Sign in to your account",
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <LoginForm />
    </Suspense>
  )
}