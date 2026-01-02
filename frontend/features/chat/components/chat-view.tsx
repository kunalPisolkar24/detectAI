"use client"

import { ChatInput } from "./chat-input"
import { MessageList } from "./message-list"

export const ChatView = () => {
  return (
    <div className="flex flex-col h-full w-full relative">
      <MessageList />
      <div className="shrink-0 z-10 bg-background/80 backdrop-blur-lg pt-4">
        <ChatInput />
      </div>
    </div>
  )
}