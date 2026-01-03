"use client"

import { useChatUIStore } from "../../stores/ui-store"
import { useChatHistory } from "../../hooks/use-chat-history"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu, SquarePen, BotIcon } from "lucide-react"
import { SidebarItem } from "./sidebar-item"
import { UserMenu } from "./user-menu"
import { cn } from "@/lib/utils"
import { teko } from "@/lib/fonts"
import { useState } from "react"

export const MobileHeader = () => {
  const { setCurrentChatId } = useChatUIStore()
  const { data: history } = useChatHistory()
  const [isOpen, setIsOpen] = useState(false)

  const handleNewChat = () => {
    setCurrentChatId(null)
    setIsOpen(false)
  }

  return (
    <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="-ml-2">
            <Menu size={20} />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[300px] p-0 flex flex-col bg-background">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="p-4 border-b flex items-center gap-2">
            <BotIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <span className={cn("text-2xl font-medium pt-1", teko.className)}>Detect AI</span>
          </div>

          <div className="p-3">
             <Button onClick={handleNewChat} className="w-full justify-start gap-2" variant="outline">
                <SquarePen size={18} />
                New Chat
             </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
             <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              History
            </div>
            {history?.map((chat) => (
              <div key={chat.id} onClick={() => setIsOpen(false)}>
                <SidebarItem chat={chat} />
              </div>
            ))}
          </div>

          <div className="p-3 border-t bg-secondary/10">
            <UserMenu isCollapsed={false} />
          </div>
        </SheetContent>
      </Sheet>

      <span className={cn("text-xl font-medium pt-1", teko.className)}>Detect AI</span>

      <Button variant="ghost" size="icon" onClick={() => setCurrentChatId(null)}>
        <SquarePen size={20} />
      </Button>
    </header>
  )
}