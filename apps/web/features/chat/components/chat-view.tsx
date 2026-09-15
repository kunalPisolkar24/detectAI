"use client"

import { ChatInput } from "./chat-input"
import { MessageList } from "./message-list"
import { ChatHeader } from "./layout/chat-header"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"
import { useQueryClient } from "@tanstack/react-query"
import { useChatUIStore } from "../stores/ui-store"

interface ChatViewProps {
  initialRateLimited?: boolean
}

export const ChatView = ({ initialRateLimited }: ChatViewProps) => {
  const setRateLimited = useChatUIStore((state) => state.setRateLimited)
  const setCurrentChatId = useChatUIStore((state) => state.setCurrentChatId)
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const previousUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (typeof initialRateLimited === "boolean") {
      setRateLimited(initialRateLimited)
    }
  }, [initialRateLimited, setRateLimited])

  useEffect(() => {
    // Preview data is namespaced per login: when the signed-in user changes,
    // drop the previous user's selection and cached chats so one frame of
    // stale data can never render under the new identity.
    const userId = session?.user?.id ?? null
    if (previousUserId.current === undefined) {
      previousUserId.current = userId
      return
    }
    if (previousUserId.current !== userId) {
      previousUserId.current = userId
      setCurrentChatId(null)
      queryClient.removeQueries({ queryKey: ["chat"] })
      queryClient.removeQueries({ queryKey: ["chat-history"] })
    }
  }, [session?.user?.id, queryClient, setCurrentChatId])

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