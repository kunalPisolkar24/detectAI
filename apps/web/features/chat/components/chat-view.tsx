"use client"

import { ChatInput } from "./chat-input"
import { MessageList } from "./message-list"
import { ChatHeader } from "./layout/chat-header"

import { useEffect } from "react"
import { useChatUIStore } from "../stores/ui-store"

interface ChatViewProps {
  initialRateLimited?: boolean
}

export const ChatView = ({ initialRateLimited }: ChatViewProps) => {
  const setRateLimited = useChatUIStore((state) => state.setRateLimited)

  useEffect(() => {
    if (typeof initialRateLimited === "boolean") {
      setRateLimited(initialRateLimited)
    }
  }, [initialRateLimited, setRateLimited])

  return (
    <div className="flex flex-col relative h-full w-full bg-background overflow-hidden isolate">
      <ChatHeader />
      <div className="flex-1 w-full overflow-y-auto scroll-smooth z-0 custom-scrollbar flex flex-col">
        <MessageList />
      </div>

      <div className="absolute bottom-0 left-0 w-full flex justify-center z-20 pointer-events-none">
        <div className="w-full max-w-4xl pointer-events-auto">
          <div className="h-12 w-full bg-gradient-to-t from-background via-background/60 to-transparent" />

          <div className="bg-background/95 backdrop-blur-xl pb-6 px-4">
            <ChatInput />
          </div>
        </div>
      </div>
    </div>
  )
}