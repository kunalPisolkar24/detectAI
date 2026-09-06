import type { Metadata } from "next"
import { Support } from "@/features/landing/support"

export const metadata: Metadata = {
  title: "Support | Detect AI",
  description: "Get help with Detect AI — getting started, billing and Premium, and questions about detection results.",
}

export default function SupportPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Support />
    </main>
  )
}
