"use client"

import { useEffect, useRef, useMemo } from "react"
import { m } from "framer-motion"
import { useChatUIStore } from "../stores/ui-store"
import { useChatSession } from "../hooks/use-chat-history"
import { useSendMessage } from "../hooks/use-chat-mutation"
import { MessageItem } from "./message-item"
import { Message } from "../types"
import { orderMessagesForDisplay } from "../utils/order-messages-for-display"

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
      <div className="flex-1 flex flex-col items-center justify-center p-8 pb-24 text-center animate-in fade-in duration-500">
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
