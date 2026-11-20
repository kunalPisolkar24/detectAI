"use client"

import { useEffect, useRef, useMemo } from "react"
import { m } from "framer-motion"
import { Flame, Gauge, Highlighter, History, ScanSearch, Zap } from "lucide-react"
import { useChatUIStore } from "../stores/ui-store"
import { useChatSession } from "../hooks/use-chat-history"
import { useSendMessage } from "../hooks/use-chat-mutation"
import { MessageItem } from "./message-item"
import { Message } from "../types"
import { orderMessagesForDisplay } from "../utils/order-messages-for-display"
import { cn } from "@/lib/core/utils"
import { inter, teko } from "@/lib/core/fonts"

export const MessageList = () => {
  const { currentChatId } = useChatUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: chat } = useChatSession(currentChatId)
  const { retryAnalysis, isAnalyzing } = useSendMessage()

  const rawMessages = useMemo(() => chat?.messages || [], [chat?.messages])
  const messages = useMemo(() => orderMessagesForDisplay(rawMessages), [rawMessages])
  const contentById = useMemo(
    () => new Map(rawMessages.map((message) => [message.id, message.content])),
    [rawMessages],
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 pb-40 text-center">
        <m.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative flex w-full max-w-xl flex-col items-center"
        >
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-visible">
            <div className="absolute left-1/2 top-0 h-56 w-56 -translate-x-[85%] rounded-full bg-blue-500/10 blur-[90px] dark:bg-blue-500/15" />
            <div className="absolute left-1/2 top-10 h-56 w-56 -translate-x-[15%] rounded-full bg-purple-500/10 blur-[90px] dark:bg-purple-500/15" />
          </div>

          <m.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
            className="mb-5 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-3.5 text-blue-700 shadow-sm dark:border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300"
          >
            <ScanSearch size={28} strokeWidth={2} />
          </m.div>

          <m.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.12 }}
            className="flex flex-col items-center"
          >
            <span className={cn("mb-2 text-[11px] font-bold uppercase tracking-widest opacity-60", inter.className)}>
              AI text detection
            </span>
            <h1 className={cn("text-4xl leading-[1.05] tracking-wide sm:text-5xl", teko.className)}>
              Human or AI?
              <span className="block bg-gradient-to-r from-blue-600 via-purple-500 to-blue-600 bg-[length:200%_100%] animate-gradient-x bg-clip-text text-transparent">
                Know in seconds.
              </span>
            </h1>
            <p className={cn("mt-3 max-w-md text-sm leading-relaxed text-muted-foreground", inter.className)}>
              Paste your text below for chunk-level analysis across our Spark and Flare models.
            </p>
          </m.div>

          <m.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.22 }}
            className="mt-6 flex flex-wrap items-stretch justify-center gap-2.5"
          >
            <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white/70 px-3.5 py-2.5 text-left shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
              <span className="rounded-lg bg-blue-500/10 p-1.5 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                <Zap size={14} />
              </span>
              <span className="flex flex-col">
                <span className={cn("text-lg leading-none tracking-wide", teko.className)}>SPARK</span>
                <span className={cn("mt-1 text-[11px] leading-none text-muted-foreground", inter.className)}>
                  Fast everyday checks
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white/70 px-3.5 py-2.5 text-left shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
              <span className="rounded-lg bg-purple-500/10 p-1.5 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
                <Flame size={14} />
              </span>
              <span className="flex flex-col">
                <span className={cn("text-lg leading-none tracking-wide", teko.className)}>FLARE</span>
                <span className={cn("mt-1 text-[11px] leading-none text-muted-foreground", inter.className)}>
                  Deep multi-layer detection
                </span>
              </span>
            </div>
          </m.div>

          <m.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.32 }}
            className={cn("mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground", inter.className)}
          >
            <li className="flex items-center gap-1.5">
              <Highlighter size={13} className="text-purple-600 dark:text-purple-400" />
              Chunk-level highlights
            </li>
            <li className="flex items-center gap-1.5">
              <Gauge size={13} className="text-blue-600 dark:text-blue-400" />
              AI vs human scores
            </li>
            <li className="flex items-center gap-1.5">
              <History size={13} className="text-emerald-600 dark:text-emerald-400" />
              Full chat history
            </li>
          </m.ul>
        </m.div>
      </div>
    )
  }

  return (
    <div className="pt-4">
      <div className="w-full max-w-4xl mx-auto px-4 pb-48 space-y-8">
        {messages.map((msg: Message) => (
          (() => {
            const sourceMessageId = msg.analysisLink?.sourceMessageId
              ?? msg.streamingProgress?.sourceMessageId
              ?? msg.analysisStatus?.sourceMessageId
            const sourceText = sourceMessageId ? contentById.get(sourceMessageId) : undefined

            return (
              <MessageItem
                key={msg.id}
                message={msg}
                sourceText={sourceText}
                onRetry={(() => {
                  if (msg.role !== "assistant") {
                    return undefined
                  }

                  const retryContent = msg.streamingProgress?.retryContent ?? sourceText
                  const model = msg.streamingProgress?.model ?? msg.analysisStatus?.model

                  if (!sourceMessageId || !retryContent || !model) {
                    return undefined
                  }

                  return () => {
                    retryAnalysis({
                      assistantMessageId: msg.id,
                      assistantCreatedAt: msg.createdAt,
                      sourceMessageId,
                      content: retryContent,
                      model,
                    })
                  }
                })()}
                isRetryDisabled={isAnalyzing}
              />
            )
          })()
        ))}
        <div ref={scrollRef} className="h-1" />
      </div>
    </div>
  )
}
