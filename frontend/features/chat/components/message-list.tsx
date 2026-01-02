"use client"

import { useEffect, useRef, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { m, AnimatePresence } from "framer-motion"
import { useChatUIStore } from "../stores/ui-store"
import { AnalysisCard } from "./analysis-card"
import { cn } from "@/lib/utils"
import { Bot, User } from "lucide-react"
import { Message, ChatSession } from "../types"
import { chatService } from "../services/mock-service"

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
      <div className="max-w-3xl mx-auto space-y-8">
        <AnimatePresence initial={false}>
          {messages.map((msg: Message) => (
            <m.div
              key={msg.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex gap-4",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                  <Bot size={16} className="text-primary" />
                </div>
              )}
              
              <div className={cn("flex flex-col max-w-[85%]", msg.role === "user" ? "items-end" : "items-start")}>
                <div className={cn(
                  "text-sm font-medium mb-1 opacity-50",
                  msg.role === "user" ? "mr-1" : "ml-1"
                )}>
                  {msg.role === "user" ? "You" : "Detect AI"}
                </div>
                
                {msg.role === "user" ? (
                   <div className="bg-secondary/50 px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed font-serif whitespace-pre-wrap border border-border/50">
                     {msg.content}
                   </div>
                ) : (
                   msg.analysis && <AnalysisCard result={msg.analysis} />
                )}
              </div>

              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0 border border-border">
                  <User size={16} className="text-muted-foreground" />
                </div>
              )}
            </m.div>
          ))}
        </AnimatePresence>
        <div ref={scrollRef} className="h-1" />
      </div>
    </div>
  )
}