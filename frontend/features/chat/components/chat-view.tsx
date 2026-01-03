"use client"

import { ChatInput } from "./chat-input"
import { MessageList } from "./message-list"
import { ChatHeader } from "./layout/chat-header"

export const ChatView = () => {
  return (
    <div className="relative h-full w-full bg-background overflow-hidden isolate">
      <ChatHeader />
      <div className="h-full w-full z-0 pt-10 md:pt-0">
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