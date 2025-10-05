import { SignupForm } from "@/components/auth"
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign Up | Detect AI',
  description: 'Create a new account with Detect AI to get started with fast and efficient AI text detection.',
};


const SignupPage = () => {
  return (
    <SignupForm />
  )
}

export default SignupPage