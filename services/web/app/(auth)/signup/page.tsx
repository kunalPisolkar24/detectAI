import type { Metadata } from "next"

import { SignupForm } from "@/features/auth/components/signup"

export const metadata: Metadata = {
  title: "Sign up | Detect AI",
  description: "Create a new account",
}

export default function SignupPage() {
  return <SignupForm />
}
