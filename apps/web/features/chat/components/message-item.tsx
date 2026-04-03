"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { merriweather } from "@/lib/fonts"
import { Message } from "../types"
import { AnalysisCard } from "./analysis-card"
import { AnalysisProgressCard } from "./analysis-progress-card"

interface MessageItemProps {
  message: Message
}

export const MessageItem = ({ message }: MessageItemProps) => {
  const isUser = message.role === "user"

  return (
    <m.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div className={cn(
        "flex flex-col w-full",
        isUser ? "items-end max-w-[85%]" : "items-start max-w-full"
      )}>
        {isUser ? (
           <div className={cn(
             "px-5 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
             "bg-white/90 dark:bg-white/10 text-neutral-800 dark:text-neutral-100",
             "border border-black/5 dark:border-white/5",
             "rounded-tr-sm", 
             merriweather.className
           )}>
             {message.content}
           </div>
        ) : (
           message.isStreaming && message.streamingProgress
             ? <AnalysisProgressCard progress={message.streamingProgress} />
             : message.analysis && <AnalysisCard result={message.analysis} />
        )}
      </div>
    </m.div>
  )
}
