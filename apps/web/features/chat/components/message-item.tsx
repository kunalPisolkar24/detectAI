"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/utils"
import { merriweather } from "@/lib/fonts"
import { Message } from "../types"
import { AnalysisCard } from "./analysis-card"
import { AnalysisProgressCard } from "./analysis-progress-card"
import { useSendMessage } from "../hooks/use-chat-mutation"

interface MessageItemProps {
  message: Message
}

export const MessageItem = ({ message }: MessageItemProps) => {
  const isUser = message.role === "user"
  const { retryAnalysis, isAnalyzing } = useSendMessage()
  const handleRetry =
    message.streamingProgress?.retryContent
      ? () =>
          retryAnalysis({
            assistantMessageId: message.id,
            content: message.streamingProgress!.retryContent!,
            model: message.streamingProgress!.model,
          })
      : undefined

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
           message.streamingProgress
             ? (
                 <AnalysisProgressCard
                   progress={message.streamingProgress}
                   onRetry={message.streamingProgress.status === "running" ? undefined : handleRetry}
                   isRetryDisabled={isAnalyzing}
                 />
               )
             : message.analysis && <AnalysisCard result={message.analysis} />
        )}
      </div>
    </m.div>
  )
}
