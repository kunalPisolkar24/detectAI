import type { Metadata } from "next"
import { Privacy } from "@/features/landing/privacy"

export const metadata: Metadata = {
  title: "Privacy Policy | Detect AI",
  description: "How Detect AI handles your information — what we collect, what we never keep, and your rights.",
}

export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Privacy />
    </main>
  )
}
