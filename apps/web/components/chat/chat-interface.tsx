"use client";
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea, ScrollBar } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowUp, RotateCcw, BotIcon, Link } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text";
import ChangeModel from "./change-model";
import { useTab } from "@/contexts/tabContext";
import { MessageSchema } from "@/schemas";
import { Skeleton } from "@workspace/ui/components/skeleton";

interface CurrentChat {
  question: string;
  response: string;
}

export function ChatInterface() {
  const [message, setMessage] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [currentChat, setCurrentChat] = useState<CurrentChat | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const msgEnd = useRef<HTMLDivElement>(null);
  const { tab } = useTab();
  const [isMobile, setIsMobile] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (currentChat && msgEnd.current) {
      setTimeout(() => {
        msgEnd.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [currentChat]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const adjustHeight = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 250)}px`;
    };
    adjustHeight();
    textarea.addEventListener("input", adjustHeight);
    return () => textarea.removeEventListener("input", adjustHeight);
  }, [message]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const validateMessage = (msg: string) => {
    if (!msg.trim()) {
      setError("");
      return;
    }
    const validationResult = MessageSchema.safeParse({ message: msg });
    if (!validationResult.success) {
      setError(validationResult.error.errors[0]?.message || "Invalid message");
    } else {
      setError("");
    }
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    const validationResult = MessageSchema.safeParse({ message });
    if (validationResult.success) {
      setIsLoading(true);
      setMessage("");
      const endpoint =
        tab === "sequential" ? "/predict/sequential" : "/predict/bert";
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_MODEL_URL}${endpoint}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.NEXT_PUBLIC_MODEL_API_SECRET}`,
            },
            body: JSON.stringify({ text: message }),
          }
        );
        if (!response.ok) {
          throw new Error("Server returned an error");
        }
        const data = await response.json();
        setCurrentChat({
          question: message,
          response: `Model: ${data.model}, Predicted Label: ${data.predicted_label}`,
        });
      } catch (error: any) {
        console.error(error);
        setCurrentChat({
          question: message,
          response: "Error: Server is likely down",
        });
      }
      setIsLoading(false);
      setIsSubmitted(true);
      setError("");
    } else {
      const errorMessage =
        validationResult.error.errors[0]?.message || "Invalid message";
      setError(errorMessage);
    }
  };

  const resetChat = () => {
    setIsSubmitted(false);
    setCurrentChat(null);
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {!isMobile && (
        <div className="absolute top-[70px] left-[5%] md:left-[5%] lg:left-[13%] z-50">
          <ChangeModel />
        </div>
      )}
      {!isSubmitted && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-x-0 top-1/3 flex flex-col items-center justify-center text-center -translate-y-1/4"
        >
          <div className="group relative mx-auto flex justify-center rounded-full px-4 py-1.5 shadow-[inset_0_-8px_10px_#8fdfff1f] transition-shadow duration-500 ease-out hover:shadow-[inset_0_-5px_10px_#8fdfff3f]">
            <span
              className={cn(
                "absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]"
              )}
              style={{
                WebkitMask:
                  "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                WebkitMaskComposite: "destination-out",
                mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                maskComposite: "subtract",
                WebkitClipPath: "padding-box",
              }}
            />
            <AnimatedGradientText className="text-sm font-medium">
              Chat
            </AnimatedGradientText>
          </div>
          <h2 className="subHeading mt-4 px-5">
            Was this written by Human or AI?
          </h2>
          <p className="subText mt-4 text-center px-5">
            AI or human? Take a wild guess—or let us do the detective work for
            you!
          </p>
        </motion.div>
      )}
      <ScrollArea className="flex-1 px-4 transition-all min-h-[40vh] max-h-[70vh]">
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
                    className="inline-block max-w-[85%] ml-auto rounded-2xl bg-muted px-5 py-3 text-right break-words whitespace-normal"
                  >
                    <p className="dark:text-zinc-200">{currentChat.question}</p>
                  </motion.div>
                  {isLoading ? (
                    <div className="flex w-full items-center gap-1.5">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <Skeleton className="w-1/4 p-4 rounded-2xl h-9" />
                    </div>
                  ) : (
                    <motion.div
                      key={`response-${currentChat.response}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      className="flex w-full items-center gap-1.5"
                    >
                      <div className="h-9 w-9 flex items-center justify-center rounded-lg border bg-muted">
                        <BotIcon className="h-5 w-5 text-primary" />
                      </div>
                      <p
                        className={`text-foreground ${currentChat.response === "Error: Server is likely down" ? "bg-red-950 p-2 text-red-300 rounded-md" : ""}`}
                      >
                        {currentChat.response === "Error: Server is likely down"
                          ? currentChat.response
                          : currentChat.response.includes("Predicted Label: 0")
                            ? "The text is likely Human Written 👨🏻‍🦱"
                            : "The text is likely AI Generated 🤖"}
                      </p>
                    </motion.div>
                  )}
                  <div className="flex justify-center">
                    <Button
                      variant="ghost"
                      className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-5 rounded-2xl"
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
      <div className="w-full p-4 fixed bottom-16 bg-background">
        <div className="relative max-w-3xl mx-auto">
          <div className="flex items-center bg-background rounded-3xl shadow-lg pb-3 border border-gray-400 dark:border-zinc-600">
            <ScrollArea className="w-full">
              <div className="px-4 pt-4 outline-none border-none w-full rounded-3xl">
                <Textarea
                  placeholder="Paste your text"
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    validateMessage(e.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                  className="resize-none w-full min-h-[50px] max-h-[210px] overflow-y-auto dark:text-zinc-200"
                />
                {error && <p className="text-red-500 mt-2">{error}</p>}
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
                      className="h-10 w-10 rounded-xl hover:bg-background"
                    >
                      <Link className="h-4 w-4" />
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
                disabled={!message.trim()}
                className="h-10 w-10 rounded-xl bg-primary text-primary-foreground hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground p-4 fixed bottom-0 w-full bg-background">
        Detect AI can make mistakes. Check important info.
      </p>
    </div>
  );
}
