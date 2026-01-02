"use client"

import { useEffect, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { m, AnimatePresence } from "framer-motion"
import { useChatUIStore } from "../stores/ui-store"
import { AnalysisCard } from "./analysis-card"
import { cn } from "@/lib/utils"
import { Message, ChatSession } from "../types"
import { chatService } from "../services/mock-service"
import { merriweather } from "@/lib/fonts"

export const MessageList = () => {
  const { currentChatId } = useChatUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: chat } = useQuery<ChatSession>({
    queryKey: ["chat", currentChatId],
    queryFn: async () => {
      if (!currentChatId) throw new Error("No chat ID provided")
      return chatService.getChat(currentChatId)
    },
    enabled: !!currentChatId,
  })

  const messages = useMemo(() => chat?.messages || [], [chat?.messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
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
    <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth">
      <div className="max-w-4xl mx-auto space-y-8">
        <AnimatePresence initial={false}>
          {messages.map((msg: Message) => (
            <m.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex w-full",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div className={cn(
                "flex flex-col w-full",
                msg.role === "user" ? "items-end max-w-[85%]" : "items-start max-w-full"
              )}>
                {msg.role === "user" ? (
                   <div className={cn(
                     "px-5 py-3 rounded-2xl text-sm sm:text-base leading-relaxed whitespace-pre-wrap shadow-sm",
                     "bg-white/90 dark:bg-white/10 text-neutral-800 dark:text-neutral-100",
                     "border border-black/5 dark:border-white/5",
                     "rounded-tr-sm", 
                     merriweather.className
                   )}>
                     {msg.content}
                   </div>
                ) : (
                   msg.analysis && <AnalysisCard result={msg.analysis} />
                )}
              </div>
            </m.div>
          ))}
        </AnimatePresence>
        <div ref={scrollRef} className="h-1" />
      </div>
    </div>
  )
}