import { SignupForm } from "@/features/auth/components/signup-form"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign Up | Detect AI",
  description: "Create a new account",
}

export default function SignupPage() {
  return <SignupForm />
}