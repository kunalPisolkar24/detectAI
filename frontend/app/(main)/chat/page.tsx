import { ChatView } from "@/features/chat/components/chat-view"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Chat | Detect AI",
  description: "Analyze text with Spark and Flare models",
}

export default function ChatPage() {
  return (
    <main className="h-full w-full overflow-hidden">
      <ChatView />
    </main>
  )
}