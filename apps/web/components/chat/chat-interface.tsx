"use client"
import type React from "react"
import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ScrollArea, ScrollBar } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { ArrowUp, RotateCcw, BotIcon, Link } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text"
import { toast } from "sonner"
import { useTab } from "@/contexts/tabContext"
import { MessageSchema } from "@/schemas"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useTheme } from "next-themes"
import { Merriweather } from 'next/font/google';
import "./style.css"

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-merriweather',
  display: 'swap',
});

interface CurrentChat {
  question: string
  response: string
}

export function ChatInterface() {
  const [message, setMessage] = useState("")
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [currentChat, setCurrentChat] = useState<CurrentChat | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const msgEnd = useRef<HTMLDivElement>(null)
  const { tab } = useTab()
  const [isMobile, setIsMobile] = useState(false)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isColdStarting, setIsColdStarting] = useState(false)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const maxRetries = 5
  const [retryCount, setRetryCount] = useState(0)
  const coldStartingRef = useRef(false)
  const { theme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = ""
      document.body.style.overflow = ""
    }
  }, [])

  useEffect(() => {
    if (currentChat && msgEnd.current) {
      setTimeout(() => {
        msgEnd.current?.scrollIntoView({ behavior: "smooth" })
      }, 100)
    }
  }, [currentChat])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const adjustHeight = () => {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 250)}px`
    }
    adjustHeight()
    textarea.addEventListener("input", adjustHeight)
    return () => textarea.removeEventListener("input", adjustHeight)
  }, [message])

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  const validateMessage = (msg: string) => {
    if (!msg.trim()) {
      setError("")
      return
    }
    const validationResult = MessageSchema.safeParse({ message: msg })
    if (!validationResult.success) {
      setError(validationResult.error.errors[0]?.message || "Invalid message")
    } else {
      setError("")
    }
  }

  const fetchWithRetry = async (endpoint: string, messageText: string, attempt = 1): Promise<any> => {
    try {
      const response = await fetch(`/api/proxy/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: messageText }),
      })

      console.log("Response status:", response.status)
      if (!response.ok) {
        if (response.status === 503 || response.status === 504 || response.status === 500) {
          if (attempt === 1) {
            setIsColdStarting(true)
            coldStartingRef.current = true
            toast.loading("Models are warming up! ⏳", {
              duration: 10000,
              id: "cold-start-toast",
            })
            console.log("Cold start initiated.")
          }
          if (attempt <= maxRetries) {
            setRetryCount(attempt)
            const retryDelay = Math.min(14000 * Math.pow(1.5, attempt - 1), 30000)
            console.log(`Attempt ${attempt} failed. Retrying in ${retryDelay} ms`)
            return new Promise((resolve) => {
              retryTimeoutRef.current = setTimeout(() => {
                resolve(fetchWithRetry(endpoint, messageText, attempt + 1))
              }, retryDelay)
            })
          } else {
            throw new Error("Server is not responding after multiple attempts")
          }
        }
        throw new Error(`Server returned ${response.status}`)
      }

      if (coldStartingRef.current) {
        console.log("Dismissing loading toast")
        toast.dismiss("cold-start-toast")
        console.log("Showing success toast")

        toast.success("Models are ready! 🚀", {
          id: "cold-start-toast",
          duration: 5000,
        })
        coldStartingRef.current = false
        setIsColdStarting(false)
        setRetryCount(0)
      }
      return response.json()
    } catch (error) {
      if (attempt <= maxRetries && coldStartingRef.current) {
        setRetryCount(attempt)
        const retryDelay = Math.min(2000 * Math.pow(1.5, attempt - 1), 10000)
        console.log(`Attempt ${attempt} caught error. Retrying in ${retryDelay} ms`)
        return new Promise((resolve) => {
          retryTimeoutRef.current = setTimeout(() => {
            resolve(fetchWithRetry(endpoint, messageText, attempt + 1))
          }, retryDelay)
        })
      }
      throw error
    }
  }

  const handleSubmit = async () => {
    if (!message.trim()) return
    const validationResult = MessageSchema.safeParse({ message })
    if (validationResult.success) {
      setIsLoading(true)
      const questionText = message
      setMessage("")
      const endpoint = tab === "sequential" ? "sequential" : "bert"

      try {
        // Set initial state for submission
        setIsSubmitted(true)
        setCurrentChat({
          question: questionText,
          response: "",
        })

        // Use the retry mechanism
        const data = await fetchWithRetry(endpoint, questionText)

        setCurrentChat({
          question: questionText,
          response: `Model: ${data.model}, Predicted Label: ${data.predicted_label}`,
        })
      } catch (error: any) {
        console.error(error)
        toast.error("Our models are currently unavailable.", {
          id: "cold-start-toast",
        })
        setCurrentChat({
          question: questionText,
          response: "Error: Server is currently unavailable. Please try again later.",
        })
        // Ensure cold start flag is cleared
        setIsColdStarting(false)
        coldStartingRef.current = false
      }

      setIsLoading(false)
      setError("")
    } else {
      const errorMessage = validationResult.error.errors[0]?.message || "Invalid message"
      setError(errorMessage)
    }
  }

  const resetChat = () => {
    setIsSubmitted(false)
    setCurrentChat(null)
    setMessage("")
    setIsColdStarting(false)
    setRetryCount(0)
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!mounted) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex-1 px-4 min-h-[40vh] max-h-[80vh]">
          <div className="w-full max-w-2xl mx-auto pt-20">
            <div className="absolute inset-x-0 top-1/3 flex flex-col items-center justify-center text-center -translate-y-1/4">
              <Skeleton className="h-8 w-32 rounded-full mb-4" />
              <Skeleton className="h-10 w-64 rounded-md mb-4" />
              <Skeleton className="h-6 w-80 rounded-md" />
            </div>
          </div>
        </div>
        <div className="w-full p-4 fixed bottom-10 bg-background">
          <div className="relative max-w-3xl mx-auto">
            <Skeleton className="h-20 w-full rounded-3xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {!isSubmitted && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-x-0 top-1/3 flex flex-col items-center justify-center text-center -translate-y-1/4"
        >
          <div
            className={cn(
              "group relative mx-auto flex justify-center rounded-full px-4 py-1.5 transition-shadow duration-500 ease-out",
              theme === "dark"
                ? "shadow-[inset_0_-8px_10px_#8fdfff1f] hover:shadow-[inset_0_-5px_10px_#8fdfff3f]"
                : "shadow-[inset_0_-8px_10px_#8fdfff4f] hover:shadow-[inset_0_-5px_10px_#8fdfff6f]",
            )}
          >
            <span
              className={cn(
                "absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]",
              )}
              style={{
                WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                WebkitMaskComposite: "destination-out",
                mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                maskComposite: "subtract",
                WebkitClipPath: "padding-box",
              }}
            />
            <AnimatedGradientText className="text-sm font-medium">Chat</AnimatedGradientText>
          </div>
          
          <h2
            className={
              
              cn(
              `mt-4 px-5 text-2xl font-bold tracking-tight seriffont`,
              theme === "dark" ? "text-white " : "text-gray-900",
            )}
          >
            Was this written by Human or AI?
          </h2>
          <p
            className={cn("mt-4 text-center px-5 mx-auto seriffont1",
              theme === "dark" ? "text-gray-300" : "text-gray-600",
            )}
          >
            AI or human? Take a wild guess—or let us do the detective work for you!
          </p>
        </motion.div>
      )}
      <ScrollArea className="flex-1 px-4 transition-all min-h-[40vh] max-h-[80vh]">
        <div className="w-full max-w-2xl mx-auto pt-20">
          <AnimatePresence mode="popLayout">
            {isSubmitted && currentChat && (
              <motion.div
                key={currentChat.question}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-2xl space-y-6 mt-2 pt-6"
              >
                <div className="flex flex-col gap-10 pt-10">
                  <motion.div
                    key={`question-${currentChat.question}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "inline-block max-w-[85%] ml-auto rounded-2xl px-5 py-3 text-right break-words whitespace-normal",
                      theme === "dark" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-900",
                    )}
                  >
                    <p>{currentChat.question}</p>
                  </motion.div>
                  {isLoading && (
                    <div className="flex w-full items-start gap-1.5">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <div className="flex-1">
                        <Skeleton className="w-3/4 p-4 rounded-2xl h-9 mb-2" />
                        {isColdStarting && (
                          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                            <span
                              className={cn(
                                "inline-block h-2 w-2 animate-pulse rounded-full",
                                theme === "dark" ? "bg-blue-400" : "bg-blue-600",
                              )}
                            ></span>
                            <p>
                              Warming up models... Retry attempt {retryCount}/{maxRetries}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {!isLoading && currentChat.response && (
                    <motion.div
                      key={`response-${currentChat.response}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="flex w-full items-start gap-1.5"
                    >
                      <div
                        className={cn(
                          "h-9 w-9 flex items-center justify-center rounded-lg border",
                          theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-gray-100 border-gray-200",
                        )}
                      >
                        <BotIcon className={cn("h-5 w-5", theme === "dark" ? "text-blue-400" : "text-blue-600")} />
                      </div>
                      <div className="flex-1">
                        <p
                          className={cn(
                            "p-3 rounded-2xl inline-block",
                            currentChat.response.includes("Error:")
                              ? theme === "dark"
                                ? "bg-red-900/50 text-red-100"
                                : "bg-red-100 text-red-800"
                              : theme === "dark"
                                ? "bg-gray-800 text-white"
                                : "bg-gray-100 text-gray-900",
                          )}
                        >
                          {currentChat.response.includes("Error:")
                            ? currentChat.response
                            : currentChat.response.includes("Predicted Label: 0")
                              ? "The text is likely Human Written 👨🏻‍🦱"
                              : "The text is likely AI Generated 🤖"}
                        </p>
                      </div>
                    </motion.div>
                  )}
                  <div className="flex justify-center">
                    <Button
                      variant="ghost"
                      className={cn(
                        "flex items-center gap-2 mb-5 rounded-2xl",
                        theme === "dark"
                          ? "text-gray-400 hover:text-white hover:bg-gray-800"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
                      )}
                      onClick={resetChat}
                    >
                      <RotateCcw className="h-4 w-4" />
                      New Chat
                    </Button>
                  </div>
                  <div ref={msgEnd} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <ScrollBar />
      </ScrollArea>
      <div className="w-full p-4 fixed bottom-10 bg-background">
        <div className="relative max-w-3xl mx-auto">
          <div
            className={cn(
              "flex items-center rounded-3xl shadow-lg pb-3 border",
              theme === "dark" ? "bg-black/40 border-gray-700" : "bg-white border-gray-300",
            )}
          >
            <ScrollArea className="w-full">
              <div className="px-4 pt-4 outline-none border-none w-full rounded-3xl">
                <Textarea
                  placeholder="Paste your text"
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value)
                    validateMessage(e.target.value)
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading && isColdStarting}
                  className={cn(
                    "resize-none w-full min-h-[50px] max-h-[210px] overflow-y-auto border-none focus-visible:ring-0 focus-visible:ring-offset-0",
                    theme === "dark"
                      ? "bg-transparent text-white placeholder:text-gray-400"
                      : "bg-transparent text-gray-900 placeholder:text-gray-500",
                  )}
                />
                {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
              </div>
              <ScrollBar />
            </ScrollArea>

            <div className="relative flex self-end gap-2 pr-4 mt-4 bottom-[16px] md:bottom-[10px]">
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={handleSubmit}
                      className={cn(
                        "h-10 w-10 rounded-xl",
                        theme === "dark"
                          ? "border-gray-700 bg-gray-800 hover:bg-gray-700"
                          : "border-gray-300 bg-gray-100 hover:bg-gray-200",
                      )}
                    >
                      <Link className={cn("h-4 w-4", theme === "dark" ? "text-gray-300" : "text-gray-700")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Coming Soon!</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                size="icon"
                onClick={handleSubmit}
                disabled={!message.trim() || (isLoading && isColdStarting)}
                className={cn(
                  "h-10 w-10 rounded-xl",
                  theme === "dark"
                    ? "bg-white text-black hover:bg-gray-200 disabled:bg-gray-800 disabled:text-gray-500"
                    : "bg-black text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400",
                )}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <p
        className={cn(
          "text-center text-xs p-4 fixed bottom-0 w-full bg-background",
          theme === "dark" ? "text-gray-400" : "text-gray-500",
        )}
      >
        Detect AI can make mistakes. Check important info.
      </p>
    </div>
  )
}
