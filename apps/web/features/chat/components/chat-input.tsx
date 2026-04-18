"use client"

import { useRef, useEffect, useState } from "react"
import { m, AnimatePresence } from "framer-motion"
import { useChatUIStore } from "../stores/ui-store"
import { useSendMessage } from "../hooks/use-chat-mutation"
import { useChatHistory } from "../hooks/use-chat-history"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Paperclip, ArrowUp, Loader2, ChevronDown, Sparkles, Square, ArrowLeftRight } from "lucide-react"
import { teko, merriweather } from "@/lib/fonts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { usePathname, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { extractTextFromFile } from "../actions/extract-file"
import { LIVE_ANALYSIS_WARNING_CHARS, MAX_LIVE_ANALYSIS_CHARS, MIN_ANALYSIS_WORDS } from "../constants"

export const ChatInput = () => {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session } = useSession()
  const { data: history } = useChatHistory()
  const isPremium = session?.user?.isPremium ?? false
  const [localInput, setLocalInput] = useState("")
  const [isExtracting, setIsExtracting] = useState(false)
  const { selectedModel, setModel, isRateLimited, currentChatId, setCurrentChatId } = useChatUIStore()
  const { sendMessage, cancelActiveAnalysis, isAnalyzing, isCancelling, activeAnalysisChatId } = useSendMessage()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentCharCount = localInput.length
  const isNearLimit = currentCharCount >= LIVE_ANALYSIS_WARNING_CHARS
  const isOverLimit = currentCharCount > MAX_LIVE_ANALYSIS_CHARS
  const isCurrentChatAnalyzing = Boolean(activeAnalysisChatId && activeAnalysisChatId === currentChatId)
  const isAnotherChatAnalyzing = Boolean(activeAnalysisChatId && activeAnalysisChatId !== currentChatId)
  const runningChatTitle = history?.find((chat) => chat.id === activeAnalysisChatId)?.title

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [localInput])

  const handleSubmit = () => {
    if (!localInput.trim() || isAnalyzing) return

    if (isOverLimit) {
      toast.error(`Text exceeds ${MAX_LIVE_ANALYSIS_CHARS.toLocaleString()} characters`)
      return
    }

    const wordCount = localInput.trim().split(/\s+/).length
    if (wordCount < MIN_ANALYSIS_WORDS) {
      toast.error(`Please enter at least ${MIN_ANALYSIS_WORDS} words (current: ${wordCount})`)
      return
    }

    sendMessage(localInput)
    setLocalInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10MB limit")
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      return
    }

    setIsExtracting(true)
    const formData = new FormData()
    formData.append("file", file)

    const result = await extractTextFromFile(formData)

    if (result.error) {
      toast.error(result.error)
    } else if (result.text) {
      const extractedText = result.text
      const nextValue = localInput ? `${localInput}\n\n${extractedText}` : extractedText

      if (nextValue.length > MAX_LIVE_ANALYSIS_CHARS) {
        toast.error(`Extracted text exceeds ${MAX_LIVE_ANALYSIS_CHARS.toLocaleString()} characters`)
      } else {
        setLocalInput(nextValue)

        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
          }
        })
      }
    }

    setIsExtracting(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  return (
    <div className="w-full">
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={cn(
          "relative flex flex-col rounded-xl overflow-hidden transition-all duration-300",
          "bg-white/70 border border-neutral-300 shadow-sm",
          "dark:bg-black/40 dark:border-white/10 dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)]",
          "supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-black/40"
        )}
      >
        {(isCurrentChatAnalyzing || isExtracting) && (
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-gradient-x z-20 opacity-50" />
        )}

        {isRateLimited && !isPremium && (
          <div className="flex items-center justify-between gap-4 bg-neutral-50 dark:bg-[#232329]/95 px-4 py-2.5 text-sm border-b border-neutral-200 dark:border-white/5">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">Usage limit reached — your limit will reset tomorrow.</span>
            <Button
              size="sm"
              onClick={() => router.push("/upgrade")}
              className={cn(
                "h-7 min-w-[100px] text-base font-medium uppercase tracking-wide shadow-sm",
                "bg-neutral-900 text-white hover:bg-neutral-800",
                "dark:bg-white dark:text-black dark:hover:bg-neutral-200",
                teko.className
              )}
            >
              UPGRADE NOW
            </Button>
          </div>
        )}

        {isAnotherChatAnalyzing && (
          <div className="flex items-center justify-between gap-4 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-sm dark:border-white/5 dark:bg-[#232329]/95">
            <span className="font-medium text-neutral-700 dark:text-neutral-200">
              {runningChatTitle
                ? `Analysis is still running in "${runningChatTitle}".`
                : "Analysis is still running in another chat."}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (activeAnalysisChatId) {
                    setCurrentChatId(activeAnalysisChatId)
                  }
                  if (pathname !== "/chat") {
                    router.push("/chat")
                  }
                }}
                className={cn(
                  "h-7 gap-1.5 rounded-lg border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-white/10 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10",
                  teko.className,
                )}
              >
                <ArrowLeftRight size={12} />
                <span className="pt-0.5 text-base tracking-wide">OPEN</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={cancelActiveAnalysis}
                disabled={isCancelling}
                className={cn(
                  "h-7 min-w-[88px] rounded-lg bg-amber-500 text-white hover:bg-amber-400",
                  teko.className,
                )}
              >
                {isCancelling ? "STOPPING" : "CANCEL"}
              </Button>
            </div>
          </div>
        )}

        <Textarea
          ref={textareaRef}
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste your text here for AI detection..."
          className={cn(
            "min-h-[60px] max-h-[200px] w-full resize-none border-0 bg-transparent px-5 py-4 text-base focus-visible:ring-0",
            "placeholder:text-neutral-400 dark:placeholder:text-neutral-500",
            "text-neutral-800 dark:text-neutral-100",
            "scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700",
            merriweather.className
          )}
          disabled={isCurrentChatAnalyzing || (isRateLimited && !isPremium)}
          aria-label="Text to analyze"
        />

        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-2">
            <m.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf,.docx,.txt"
                onChange={handleFileSelect}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-neutral-500 hover:text-blue-600 hover:bg-blue-50/50 dark:text-neutral-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                disabled={isCurrentChatAnalyzing || isExtracting || (isRateLimited && !isPremium)}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach file"
              >
                {isExtracting ? (
                  <Loader2 size={18} className="animate-spin text-blue-600 dark:text-blue-400" />
                ) : (
                  <Paperclip size={18} aria-hidden="true" />
                )}
              </Button>
            </m.div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 gap-2 px-3 text-xs font-medium rounded-lg border-neutral-200 dark:border-white/10",
                    "bg-white/50 hover:bg-black/5 dark:bg-white/5 dark:hover:bg-white/10",
                    "text-neutral-700 dark:text-neutral-200 transition-all duration-200"
                  )}
                  disabled={isCurrentChatAnalyzing}
                  aria-label={`Select model, current: ${selectedModel}`}
                >
                  <span className="capitalize tracking-wide">{selectedModel}</span>
                  <ChevronDown size={12} className="opacity-50" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-[200px] p-1.5 rounded-xl bg-white/95 dark:bg-black/95 backdrop-blur-xl border-neutral-200 dark:border-white/10 shadow-lg"
              >
                <DropdownMenuItem
                  onClick={() => setModel("spark")}
                  className="rounded-lg p-2 focus:bg-neutral-100 dark:focus:bg-white/10 cursor-pointer mb-1"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-xs">Spark</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">Fast analysis for everyday content.</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (!isPremium) {
                      router.push("/upgrade")
                      return
                    }
                    setModel("flare")
                  }}
                  className="rounded-lg p-2 focus:bg-neutral-100 dark:focus:bg-white/10 cursor-pointer flex items-center justify-between"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-xs">Flare</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">Deep, multi-layered detection.</span>
                  </div>
                  {(!isPremium) && (
                    <span className="text-[10px] font-medium text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 ml-2">
                      Upgrade
                    </span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-3">
            <div className={cn(
              "text-[11px] font-medium tabular-nums transition-colors",
              isOverLimit
                ? "text-red-600 dark:text-red-400"
                : isNearLimit
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-neutral-500 dark:text-neutral-400"
            )}>
              {currentCharCount.toLocaleString()} / {MAX_LIVE_ANALYSIS_CHARS.toLocaleString()}
            </div>

            <m.div
              initial={false}
              animate={{
                scale: isCurrentChatAnalyzing || localInput.trim() ? 1 : 0.95,
                opacity: isCurrentChatAnalyzing || localInput.trim() ? 1 : 0.8
              }}
              whileHover={isCurrentChatAnalyzing || localInput.trim() ? { scale: 1.02 } : {}}
              whileTap={isCurrentChatAnalyzing || localInput.trim() ? { scale: 0.98 } : {}}
            >
              <Button
                onClick={isCurrentChatAnalyzing ? cancelActiveAnalysis : handleSubmit}
                disabled={
                  isCancelling ||
                  isExtracting ||
                  (!isCurrentChatAnalyzing && (!localInput.trim() || isOverLimit || isAnalyzing || (isRateLimited && !isPremium)))
                }
                className={cn(
                  "h-9 min-w-[36px] rounded-lg transition-all duration-300 px-3 sm:px-5",
                  isCurrentChatAnalyzing
                    ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20 hover:shadow-amber-500/30 hover:from-amber-400 hover:to-orange-400"
                    : "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md shadow-blue-500/20 hover:shadow-blue-500/30 hover:from-blue-500 hover:to-purple-500",
                  "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                  teko.className
                )}
                aria-label={isCurrentChatAnalyzing ? "Cancel analysis" : "Analyze text"}
              >
                <AnimatePresence mode="wait">
                  {isCancelling ? (
                    <m.div
                      key="loader"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                    >
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    </m.div>
                  ) : isCurrentChatAnalyzing ? (
                    <m.div
                      key="stop"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className="flex items-center gap-2"
                    >
                      <span className="hidden sm:inline text-lg tracking-wide pt-0.5">STOP</span>
                      <Square size={14} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
                    </m.div>
                  ) : (
                    <m.div
                      key="arrow"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      className="flex items-center gap-2"
                    >
                      <span className="hidden sm:inline text-lg tracking-wide pt-0.5">
                        {isAnotherChatAnalyzing ? "WAIT" : "ANALYZE"}
                      </span>
                      <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
                    </m.div>
                  )}
                </AnimatePresence>
              </Button>
            </m.div>
          </div>
        </div>
      </m.div>

      <div className="mt-3 flex justify-center">
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5 opacity-80">
          <Sparkles size={9} aria-hidden="true" />
          <span>AI can make mistakes. Verify important results.</span>
        </p>
      </div>
    </div>
  )
}
