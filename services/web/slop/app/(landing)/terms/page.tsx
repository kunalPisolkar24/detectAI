import type { Metadata } from "next"
import { Terms } from "@/features/landing/terms"

export const metadata: Metadata = {
  title: "Terms of Service | Detect AI",
  description: "The ground rules for using Detect AI — plans and billing, acceptable use, AI-result disclaimers, and liability.",
}

export default function TermsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Terms />
    </main>
  )
}
