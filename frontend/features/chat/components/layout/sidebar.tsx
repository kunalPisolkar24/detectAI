"use client"

import { useChatUIStore } from "../../stores/ui-store"
import { useChatHistory } from "../../hooks/use-chat-history"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { m, AnimatePresence } from "framer-motion"
import { PanelLeftClose, PanelLeftOpen, CircleFadingPlus, BotIcon } from "lucide-react"
import { SidebarItem } from "./sidebar-item"
import { UserMenu } from "./user-menu"
import { teko } from "@/lib/fonts"
import Link from "next/link"

export const Sidebar = () => {
  const { isSidebarOpen, toggleSidebar, setCurrentChatId } = useChatUIStore()
  const { data: history } = useChatHistory()

  const handleNewChat = () => {
    setCurrentChatId(null)
  }

  return (
    <m.aside
      initial={false}
      animate={{ 
        width: isSidebarOpen ? 260 : 60,
      }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "hidden md:flex flex-col h-full border-r border-border bg-background/50 backdrop-blur-xl relative z-30 shrink-0",
        "bg-neutral-50/50 dark:bg-black/20"
      )}
    >
      <div className="p-3 flex items-center justify-between h-14">
        <AnimatePresence mode="wait">
          {isSidebarOpen ? (
            <m.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 pl-2"
            >
               <Link href="/" className="flex items-center gap-2 group">
                <BotIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <span className={cn("text-xl font-medium tracking-wide pt-1", teko.className)}>
                  Detect AI
                </span>
              </Link>
            </m.div>
          ) : (
             <div className="w-full flex justify-center">
                <BotIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
             </div>
          )}
        </AnimatePresence>

        {isSidebarOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <PanelLeftClose size={18} />
          </Button>
        )}
      </div>

      <div className="px-3 py-2">
        <Button
          onClick={handleNewChat}
          variant="outline"
          className={cn(
            "w-full justify-start gap-2 bg-background hover:bg-secondary/50 border-border/50 shadow-sm transition-all",
            !isSidebarOpen && "px-0 justify-center"
          )}
        >
          <CircleFadingPlus size={18} className="shrink-0" />
          {isSidebarOpen && <span className="truncate">New Chat</span>}
        </Button>
      </div>

      {!isSidebarOpen && (
        <div className="px-3 pb-2 flex justify-center">
           <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="h-8 w-8 text-muted-foreground"
          >
            <PanelLeftOpen size={18} />
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent py-2">
        {isSidebarOpen ? (
          <div className="space-y-1">
            <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider opacity-70">
              Recent Chats
            </div>
            {history?.map((chat) => (
              <SidebarItem key={chat.id} chat={chat} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 mt-2">
             <div className="w-8 h-px bg-border/50" />
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border mt-auto">
        <UserMenu isCollapsed={!isSidebarOpen} />
      </div>
    </m.aside>
  )
}