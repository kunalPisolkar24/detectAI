"use client"

import { m } from "framer-motion"
import { cn } from "@/lib/core/utils"
import { merriweather } from "@/lib/core/fonts"
import { Message } from "../types"
import { AnalysisCard } from "./analysis-card"
import { AnalysisHighlightPanel } from "./analysis-highlight-panel"
import { AnalysisProgressCard } from "./analysis-progress-card"

interface MessageItemProps {
  message: Message
  sourceText?: string
  onRetry?: () => void
  isRetryDisabled?: boolean
}

export const MessageItem = ({ message, sourceText, onRetry, isRetryDisabled = false }: MessageItemProps) => {
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
        "flex flex-col w-full min-w-0",
        isUser ? "items-end max-w-[85%]" : "items-start max-w-full"
      )}>
        {isUser ? (
           <div className={cn(
             "px-5 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm",
             "bg-white/90 dark:bg-white/10 text-neutral-800 dark:text-neutral-100",
             "border border-black/5 dark:border-white/5",
             "rounded-tr-sm max-w-full break-words",
             merriweather.className
           )}>
             {message.content}
           </div>
        ) : (
           message.streamingProgress
             ? (
                 <AnalysisProgressCard
                   progress={message.streamingProgress}
                   onRetry={message.streamingProgress.status === "running" ? undefined : onRetry}
                   isRetryDisabled={isRetryDisabled}
                 />
               )
             : message.analysisStatus
               ? (
                   <AnalysisProgressCard
                     progress={{
                       model: message.analysisStatus.model,
                       processedChunks: 0,
                       totalChunks: 0,
                       status: message.analysisStatus.state,
                       error: message.analysisStatus.error,
                     }}
                     onRetry={onRetry}
                     isRetryDisabled={isRetryDisabled}
                   />
                 )
               : message.analysis
                 ? (
                     <div className="flex w-full flex-col items-start gap-4">
                       <AnalysisHighlightPanel
                         sourceText={sourceText ?? ""}
                         highlights={message.analysis.highlights}
                       />
                       <AnalysisCard result={message.analysis} />
                     </div>
                   )
                 : null
        )}
      </div>
    </m.div>
  )
}
