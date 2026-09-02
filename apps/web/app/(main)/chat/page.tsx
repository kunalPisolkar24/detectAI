import { ChatView } from "@/features/chat/components/chat-view"
import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/config/auth-options"
import { rateLimitService } from "@/features/rate-limit/services/rate-limit-service"

export const metadata: Metadata = {
  title: "Chat | Detect AI",
  description: "Analyze text with Spark and Flare models",
}

export default async function ChatPage() {
  // session.user.isPremium is refreshed via jwt fallback revalidate (auth-options.ts:96, 60s throttle) and pendingUpgrade resume (upgrade-view.tsx)
  const session = await getServerSession(authOptions)
  let isRateLimited = false

  if (session?.user?.id) {
    const { allowed } = await rateLimitService.checkLimit(
      session.user.id,
      session.user.isPremium ?? false
    )
    isRateLimited = !allowed
  }

  return (
    <main className="h-full w-full overflow-hidden">
      <ChatView initialRateLimited={isRateLimited} />
    </main>
  )
}