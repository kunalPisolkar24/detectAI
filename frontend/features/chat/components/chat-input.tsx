"use client"

import { useRef, useEffect } from "react"
import { useChatUIStore } from "../stores/ui-store"
import { useSendMessage } from "../hooks/use-chat-mutation"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Paperclip, ArrowUp, Zap, Sparkles, Loader2 } from "lucide-react"
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
    <div className="w-full max-w-3xl mx-auto px-4 pb-6">
      <div className="relative flex flex-col bg-secondary/40 border border-border/50 rounded-2xl shadow-sm focus-within:ring-1 focus-within:ring-ring/20 focus-within:border-ring/40 transition-all duration-200">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste text for analysis..."
          className="min-h-[60px] max-h-[200px] w-full resize-none border-0 bg-transparent px-4 py-4 text-base focus-visible:ring-0 placeholder:text-muted-foreground/50 font-serif leading-relaxed"
          style={{ fontFamily: 'var(--font-merriweather), serif' }}
          disabled={isPending}
        />
        
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg"
              disabled={isPending}
            >
              <Paperclip size={18} />
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 gap-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background/50"
                  disabled={isPending}
                >
                  {selectedModel === "spark" ? <Zap size={14} className="text-blue-500" /> : <Sparkles size={14} className="text-purple-500" />}
                  <span className="capitalize">{selectedModel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[200px]">
                <DropdownMenuItem onClick={() => setModel("spark")}>
                  <Zap size={14} className="mr-2 text-blue-500" />
                  <div className="flex flex-col">
                    <span className="font-medium">Spark</span>
                    <span className="text-[10px] text-muted-foreground">Fast, sequential analysis</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setModel("flare")}>
                  <Sparkles size={14} className="mr-2 text-purple-500" />
                  <div className="flex flex-col">
                    <span className="font-medium">Flare</span>
                    <span className="text-[10px] text-muted-foreground">Deep, BERT-based analysis</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button 
            size="icon"
            onClick={handleSubmit}
            disabled={!input.trim() || isPending}
            className={cn(
              "h-8 w-8 rounded-lg transition-all duration-200",
              input.trim() ? "opacity-100" : "opacity-50"
            )}
          >
            {isPending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </Button>
        </div>
      </div>
      <div className="mt-2 text-center">
        <p className="text-[10px] text-muted-foreground/50">
          Detect AI can make mistakes. Please verify important information.
        </p>
      </div>
    </div>
  )
}