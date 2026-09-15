import type { Metadata } from "next"
import { Contact } from "@/features/landing/contact"

export const metadata: Metadata = {
  title: "Contact | Detect AI",
  description: "Get in touch with the Detect AI team — general questions, feedback, partnerships, and support.",
}

export default function ContactPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between">
      <Contact />
    </main>
  )
}
