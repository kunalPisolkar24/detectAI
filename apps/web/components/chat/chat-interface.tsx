"use client";

import type React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChat } from "@/contexts/chatContext";
import { ScrollArea, ScrollBar } from "@workspace/ui/components/scroll-area";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowUp, RotateCcw, BotIcon, Paperclip, RotateCw } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { AnimatedGradientText } from "@workspace/ui/components/magicui/animated-gradient-text";
import { toast } from "sonner";
import { useTab } from "@/contexts/tabContext";
import { MessageSchema } from "@/schemas";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useTheme } from "next-themes";
import { Merriweather } from 'next/font/google';
import { useSession } from "next-auth/react";
import type { UserProfileData } from "@/app/api/user/profile/route";
import "./style.css";

const merriweather = Merriweather({
  subsets: ['latin'],
  weight: ['400', '700'],
});

interface Message {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface Chat {
    _id: string;
    userId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

export function ChatInterface() {
  const [message, setMessage] = useState("");
  const [tempUserMessage, setTempUserMessage] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgEnd = useRef<HTMLDivElement>(null);
  
  const { tab } = useTab();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { data: session, status: sessionStatus } = useSession();

  const {
    activeChat,
    messages,
    loading: contextLoading,
    createChat,
    addMessage,
    startNewChat
  } = useChat();

  const isSubmitted = !!activeChat || isLoading || messages.length > 0;

  const lastMessageIsAssistant = messages.length > 0 && messages[messages.length - 1]?.role === 'assistant';

  const [userProfileData, setUserProfileData] = useState<UserProfileData | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (sessionStatus !== 'authenticated') return;
    setIsLoadingProfile(true);
    setProfileError(null);
    try {
      const response = await fetch('/api/user/profile');
      if (!response.ok) throw new Error('Failed to fetch profile');
      const data: UserProfileData = await response.json();
      setUserProfileData(data);
    } catch (err) {
      console.error("Error fetching profile:", err);
      setProfileError("Could not load usage data.");
    } finally {
      setIsLoadingProfile(false);
    }
  }, [sessionStatus]);

  useEffect(() => {
    setMounted(true);
    fetchProfile();
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [fetchProfile]);

  useEffect(() => {
    if ((messages.length > 0 || isLoading || tempUserMessage) && msgEnd.current) {
      setTimeout(() => {
        msgEnd.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  }, [messages, isLoading, tempUserMessage]);

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

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error("Invalid file type. Please upload a .txt, .pdf, or .docx file.");
      if (event.target) event.target.value = '';
      return;
    }

    setIsUploadingFile(true);
    const uploadToastId = toast.loading("Processing your file...");
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/proxy/upload', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'File upload failed' }));
        throw new Error(errorData.error || 'File upload failed');
      }
      const data = await response.json();
      setMessage(data.text);
      toast.success("File processed successfully!", { id: uploadToastId });
    } catch (error: any) {
      console.error("Error uploading file:", error);
      toast.error(error.message || "Failed to process the uploaded file.", { id: uploadToastId });
    } finally {
      setIsUploadingFile(false);
      if (event.target) event.target.value = '';
    }
  };
  
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

  const isLimitReached = !session?.user?.isPremium &&
    userProfileData?.usage?.apiCalls?.limit !== null &&
    userProfileData?.usage?.apiCalls?.current !== undefined &&
    userProfileData.usage.apiCalls.current >= userProfileData.usage.apiCalls.limit;

  const incrementUsage = async () => {
    try {
      await fetch('/api/user/usage/increment', { method: 'POST' });
      fetchProfile();
    } catch (error) {
      console.error("Failed to increment usage:", error);
    }
  };

  const handleSubmit = async () => {
    if (!message.trim() || isLoading) return;

    if (isLimitReached) {
      toast.info("Daily prompt limit reached. Please come back tomorrow or upgrade.");
      return;
    }

    const validationResult = MessageSchema.safeParse({ message });
    if (!validationResult.success) {
      setError(validationResult.error.errors[0]?.message || "Invalid message");
      return;
    }

    const questionText = message;
    
    setMessage("");
    setTempUserMessage(questionText);
    setIsLoading(true);
    setError("");

    let targetChat: Chat | null = activeChat;

    try {
      if (!targetChat) {
        const newChat = await createChat(questionText);
        if (newChat) {
          targetChat = newChat;
        }
        setTempUserMessage(null); 
      } else {
        await addMessage({ role: 'user', content: questionText });
        setTempUserMessage(null);
      }

      if (!targetChat) {
        throw new Error("Chat session is not available.");
      }

      const endpoint = tab === "sequential" ? "sequential" : "bert";
      const response = await fetch(`/api/proxy/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: questionText }),
      });

      if (!response.ok) throw new Error(`Server returned ${response.status}`);

      const data = await response.json();
      const responseContent = `Model: ${data.model}, Predicted Label: ${data.predicted_label}`;

      await addMessage({ role: 'assistant', content: responseContent }, targetChat);
      
      setIsLoading(false);

      await incrementUsage();

    } catch (error: any) {
      console.error("API call failed:", error);
      setTempUserMessage(null);
      const errorMessage = "Error: Our models are currently unavailable. Please try again later.";
      toast.error(errorMessage);
      
      if (targetChat) {
         await addMessage({ role: 'assistant', content: errorMessage }, targetChat);
      }
      setIsLoading(false);
    } 
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!mounted || (sessionStatus === 'loading' && !userProfileData) || (sessionStatus === 'authenticated' && isLoadingProfile && !userProfileData)) {
    return (
      <div className="relative flex h-full flex-col bg-background text-foreground">
        <div className="absolute inset-x-0 top-1/3 flex flex-col items-center justify-center text-center -translate-y-1/2 px-4">
          <Skeleton className="h-8 w-24 rounded-full mb-4" />
          <Skeleton className="h-8 w-80 max-w-full rounded-md mb-4" />
          <Skeleton className="h-6 w-96 max-w-full rounded-md" />
        </div>
        <div className="cutpad w-full p-4 absolute bottom-10 inset-x-0 bg-background">
          <div className="relative max-w-3xl mx-auto">
            <Skeleton className="h-20 w-full rounded-3xl" />
          </div>
        </div>
        <div className="absolute bottom-0 inset-x-0 p-4">
          <div className="flex justify-center">
            <Skeleton className="h-4 w-64 rounded-md" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      {!isSubmitted && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-x-0 top-1/3 flex flex-col items-center justify-center text-center -translate-y-1/2 px-4"
        >
          <div className={cn("group relative mx-auto flex justify-center rounded-full px-4 py-1.5 transition-shadow duration-500 ease-out", theme === "dark" ? "shadow-[inset_0_-8px_10px_#8fdfff1f] hover:shadow-[inset_0_-5px_10px_#8fdfff3f]" : "shadow-[inset_0_-8px_10px_#8fdfff4f] hover:shadow-[inset_0_-5px_10px_#8fdfff6f]")}>
            <span className={cn("absolute inset-0 block h-full w-full animate-gradient rounded-[inherit] bg-gradient-to-r from-[#ffaa40]/50 via-[#9c40ff]/50 to-[#ffaa40]/50 bg-[length:300%_100%] p-[1px]")} style={{ WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "destination-out", mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", maskComposite: "subtract", WebkitClipPath: "padding-box" }} />
            <div className="mr-2">💬</div>
            <AnimatedGradientText className="text-sm font-medium">Chat</AnimatedGradientText>
          </div>
          <h2 className={cn(`mt-4 px-5 text-2xl font-bold tracking-tight ${merriweather.className} font-serif tracking-[0.5px]`, theme === "dark" ? "text-white " : "text-gray-900")}>
            Was this written by Human or AI?
          </h2>
          <p className={cn(`mt-4 text-center px-5 mx-auto ${merriweather.className} font-serif tracking-[0.5px]`, theme === "dark" ? "text-gray-300" : "text-gray-600")}>
            AI or human? Take a wild guess—or let us do the detective work for you!
          </p>
        </motion.div>
      )}
      
      <ScrollArea className="flex-1 px-4 pt-14 md:pt-0 transition-all min-h-[40vh] max-h-[80vh]">
        <div className="w-full max-w-2xl mx-auto">
          <AnimatePresence mode="popLayout">
            {isSubmitted && (
              <motion.div className="w-full max-w-2xl space-y-6 pt-4 pb-24 md:pb-40">
                <div className="flex flex-col gap-6">
                  
                  {messages.map((msg: Message) => (
                    <motion.div
                      key={msg._id}
                      initial={{ opacity: 0, x: msg.role === 'user' ? 50 : -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: msg.role === 'user' ? 50 : -50 }}
                      transition={{ duration: 0.3 }}
                      className={cn("flex w-full items-start gap-2.5", msg.role === 'user' && "justify-end")}
                    >
                      {msg.role === 'assistant' && (
                        <div className={cn("h-9 w-9 mt-1 flex-shrink-0 flex items-center justify-center rounded-lg border", theme === "dark" ? "bg-gray-800 border-gray-700" : "bg-gray-100 border-gray-200")}>
                          <BotIcon className={cn("h-5 w-5", theme === "dark" ? "text-blue-400" : "text-blue-600")} />
                        </div>
                      )}
                      <div className={cn(
                        "p-3 rounded-2xl inline-block max-w-[85%] break-words whitespace-normal",
                        msg.role === 'user' ? (theme === "dark" ? "bg-gray-800 text-white ml-auto" : "bg-gray-100 text-gray-900 ml-auto") :
                          msg.content.includes("Error:") ? (theme === "dark" ? "bg-red-900/50 text-red-100" : "bg-red-100 text-red-800") :
                            (theme === "dark" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-900")
                      )}>
                        <p>
                          {msg.role === 'assistant' && !msg.content.includes("Error:")
                            ? msg.content.includes("Predicted Label: 0")
                              ? "The text is likely Human Written 👨🏻‍🦱"
                              : "The text is likely AI Generated 🤖"
                            : msg.content}
                        </p>
                      </div>
                    </motion.div>
                  ))}

                  {tempUserMessage && (
                    <motion.div
                      key="temp-user-msg"
                      initial={{ opacity: 0, x: 50 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex w-full items-start gap-2.5 justify-end"
                    >
                       <div className={cn(
                        "p-3 rounded-2xl inline-block max-w-[85%] break-words whitespace-normal",
                        theme === "dark" ? "bg-gray-800 text-white ml-auto" : "bg-gray-100 text-gray-900 ml-auto"
                      )}>
                        <p>{tempUserMessage}</p>
                      </div>
                    </motion.div>
                  )}

                  {isLoading && !lastMessageIsAssistant && (
                    <motion.div
                      key="loading-skeleton"
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -50 }}
                      transition={{ duration: 0.3 }}
                      className="flex w-full items-start gap-2.5"
                    >
                      <Skeleton className="h-9 w-9 rounded-lg mt-1" />
                      <div className="flex-1">
                        <Skeleton className="w-3/4 p-4 rounded-2xl h-9 mb-2" />
                      </div>
                    </motion.div>
                  )}
                  
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="ghost"
                      className={cn("flex items-center gap-2 rounded-2xl", theme === "dark" ? "text-gray-400 hover:text-white hover:bg-gray-800" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100")}
                      onClick={startNewChat}
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
      <div className="cutpad w-full p-4 absolute bottom-10 inset-x-0 bg-background">
        <div className="relative max-w-3xl mx-auto">
          <div className={cn("flex items-center rounded-3xl shadow-lg pb-3 border", theme === "dark" ? "bg-black/40 border-gray-700" : "bg-white border-gray-300")}>
            <ScrollArea className="w-full">
              <div className="px-4 pt-4 outline-none border-none w-full rounded-3xl">
                <Textarea
                  placeholder="Paste your text or upload a file"
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    validateMessage(e.target.value);
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading || contextLoading || isLimitReached || isUploadingFile}
                  className={cn("resize-none w-full min-h-[50px] max-h-[210px] overflow-y-auto border-none focus-visible:ring-0 focus-visible:ring-offset-0", theme === "dark" ? "bg-transparent text-white placeholder:text-gray-400" : "bg-transparent text-gray-900 placeholder:text-gray-500", (isLimitReached || isLoading || contextLoading) && "opacity-60 cursor-not-allowed", isUploadingFile && "opacity-60 cursor-wait")}
                />
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".txt,.pdf,.docx" disabled={isUploadingFile} />
                {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
                {isLimitReached && <p className="text-amber-500 mt-2 text-xs px-1">Daily free limit reached.</p>}
                {profileError && <p className="text-red-500 mt-2 text-xs px-1">{profileError}</p>}
              </div>
              <ScrollBar />
            </ScrollArea>
            <div className="relative flex self-end gap-2 pr-4 mt-4 bottom-[16px] md:bottom-[10px]">
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploadingFile || isLoading || contextLoading} className={cn("h-10 w-10 rounded-xl", theme === "dark" ? "border-gray-700 bg-gray-800 hover:bg-gray-700 disabled:opacity-50" : "border-gray-300 bg-gray-100 hover:bg-gray-200 disabled:opacity-50")}>
                      {isUploadingFile ? <RotateCw className={cn("h-4 w-4 animate-spin", theme === "dark" ? "text-gray-400" : "text-gray-500")} /> : <Paperclip className={cn("h-4 w-4", theme === "dark" ? "text-gray-400" : "text-gray-500")} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>Upload a file (.txt, .pdf, .docx)</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button size="icon" onClick={handleSubmit} disabled={!message.trim() || isLoading || contextLoading || isLimitReached || isUploadingFile} className={cn("h-10 w-10 rounded-xl", theme === "dark" ? "bg-white text-black hover:bg-gray-200 disabled:bg-gray-800 disabled:text-gray-500" : "bg-black text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400")}>
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {userProfileData && userProfileData.usage.apiCalls.limit !== null && !session?.user?.isPremium && (
            <p className="text-center text-xs mt-2 text-muted-foreground">
              {userProfileData.usage.apiCalls.current} / {userProfileData.usage.apiCalls.limit} daily calls used.
            </p>
          )}
        </div>
      </div>
      <p className={cn("text-center text-xs p-4 absolute bottom-0 inset-x-0 w-full bg-background", theme === "dark" ? "text-gray-400" : "text-gray-500")}>
        Detect AI can make mistakes. Check important info.
      </p>
    </div>
  )
}