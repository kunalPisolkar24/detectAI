"use client"

import { useEffect, useRef, useMemo } from "react"
import { m } from "framer-motion"
import { useChatUIStore } from "../stores/ui-store"
import { useChatHistory } from "../hooks/use-chat-history"
import { MessageItem } from "./message-item"
import { Message } from "../types"

export const MessageList = () => {
  const { currentChatId } = useChatUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const { data: chat } = useChatHistory(currentChatId)
  
  const messages = useMemo(() => chat?.messages || [], [chat?.messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
        <div className="mb-6 p-4 rounded-full bg-secondary/30 border border-border/50">
          <m.div 
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            className="text-4xl"
          >
            🕵️‍♂️
          </m.div>
        </div>
        <h1 className="text-3xl font-serif font-medium tracking-tight mb-2">
          Was this written by Human or AI?
        </h1>
        <p className="text-muted-foreground max-w-md mx-auto text-sm leading-relaxed">
          Paste your text below. Our <strong>Spark</strong> and <strong>Flare</strong> models will analyze patterns to detect artificial authorship.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto scroll-smooth">
      <div className="w-full max-w-4xl mx-auto px-4 pt-6 pb-48 space-y-8">
        {messages.map((msg: Message) => (
          <MessageItem key={msg.id} message={msg} />
        ))}
        <div ref={scrollRef} className="h-1" />
      </div>
    </div>
  )
}