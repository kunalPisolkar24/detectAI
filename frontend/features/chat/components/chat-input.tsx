"use client"

import { useRef, useEffect } from "react"
import { m, AnimatePresence } from "framer-motion"
import { useChatUIStore } from "../stores/ui-store"
import { useSendMessage } from "../hooks/use-chat-mutation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Paperclip, ArrowUp, Loader2, ChevronDown, Sparkles } from "lucide-react"
import { teko, merriweather } from "@/lib/fonts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export const ChatInput = () => {
  const { input, setInput, selectedModel, setModel } = useChatUIStore()
  const { mutate, isPending } = useSendMessage()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [input])

  const handleSubmit = () => {
    if (!input.trim() || isPending) return
    mutate(input)
    setInput("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 pb-8">
      <m.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={cn(
          "relative flex flex-col rounded-xl overflow-hidden transition-all duration-300",
          "bg-white/70 border border-neutral-300 shadow-sm",
          "dark:bg-black/40 dark:border-white/10 dark:shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)]",
          "backdrop-blur-xl supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-black/40"
        )}
      >
        {isPending && (
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 animate-gradient-x z-20 opacity-50" />
        )}

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste your text here for AI detection..."
          className={cn(
            "min-h-[60px] max-h-[200px] w-full resize-none border-0 bg-transparent px-5 py-4 text-base focus-visible:ring-0",
            "placeholder:text-neutral-400 dark:placeholder:text-neutral-500",
            "text-neutral-800 dark:text-neutral-100",
            "scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700",
            merriweather.className
          )}
          disabled={isPending}
        />
        
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-2">
            <m.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-neutral-500 hover:text-blue-600 hover:bg-blue-50/50 dark:text-neutral-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                disabled={isPending}
              >
                <Paperclip size={18} />
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
                  disabled={isPending}
                >
                  <span className="capitalize tracking-wide">{selectedModel}</span>
                  <ChevronDown size={12} className="opacity-50" />
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
                  onClick={() => setModel("flare")}
                  className="rounded-lg p-2 focus:bg-neutral-100 dark:focus:bg-white/10 cursor-pointer"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-xs">Flare</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">Deep, multi-layered detection.</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <m.div
            initial={false}
            animate={{ 
              scale: input.trim() ? 1 : 0.95,
              opacity: input.trim() ? 1 : 0.8
            }}
            whileHover={input.trim() ? { scale: 1.02 } : {}}
            whileTap={input.trim() ? { scale: 0.98 } : {}}
          >
            <Button 
              onClick={handleSubmit}
              disabled={!input.trim() || isPending}
              className={cn(
                "h-9 min-w-[36px] rounded-lg transition-all duration-300 px-3 sm:px-5",
                "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md shadow-blue-500/20",
                "hover:shadow-blue-500/30 hover:from-blue-500 hover:to-purple-500",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
                teko.className
              )}
            >
              <AnimatePresence mode="wait">
                {isPending ? (
                  <m.div
                    key="loader"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                  >
                    <Loader2 size={16} className="animate-spin" />
                  </m.div>
                ) : (
                  <m.div
                    key="arrow"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="flex items-center gap-2"
                  >
                    <span className="hidden sm:inline text-lg tracking-wide pt-0.5">ANALYZE</span>
                    <ArrowUp size={16} strokeWidth={2.5} />
                  </m.div>
                )}
              </AnimatePresence>
            </Button>
          </m.div>
        </div>
      </m.div>

      <div className="mt-3 flex justify-center">
        <p className="text-[10px] text-neutral-400 dark:text-neutral-500 flex items-center gap-1.5 opacity-80">
          <Sparkles size={9} />
          <span>AI can make mistakes. Verify important results.</span>
        </p>
      </div>
    </div>
  )
}