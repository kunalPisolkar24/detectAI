"use client"

import { useChatUIStore } from "../../stores/ui-store"
import { useChatSession } from "../../hooks/use-chat-history"
import { useChatMutations } from "../../hooks/use-chat-mutation"
import { cn } from "@/lib/utils"
import { teko } from "@/lib/fonts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { ChevronDown, Trash2, Pencil } from "lucide-react"
import { useState } from "react"
import { Input } from "@/components/ui/input"

export const ChatHeader = () => {
  const { currentChatId } = useChatUIStore()
  const { data: chat } = useChatSession(currentChatId)
  const { deleteChat, renameChat } = useChatMutations()
  
  const [isRenaming, setIsRenaming] = useState(false)
  const [title, setTitle] = useState("")

  if (!currentChatId || !chat) return null

  // Initialize state only when entering edit mode
  const startRenaming = () => {
    setTitle(chat.title)
    setIsRenaming(true)
  }

  const handleRename = () => {
    // Only mutate if title actually changed and is not empty
    if (title.trim() && title !== chat.title) {
      renameChat.mutate({ id: currentChatId, title: title.trim() })
    }
    setIsRenaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleRename()
    }
    if (e.key === "Escape") {
      setIsRenaming(false)
    }
  }

  return (
    <div className="absolute top-0 left-0 w-full z-10 h-14 flex items-center justify-center pointer-events-none">
       <div className="pointer-events-auto bg-background/50 backdrop-blur-sm px-4 py-1.5 rounded-full border border-black/5 dark:border-white/5 shadow-sm mt-2 flex items-center gap-2 max-w-[90vw]">
          {isRenaming ? (
            <Input 
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={handleKeyDown}
              className={cn(
                "h-7 w-[200px] text-center bg-transparent border-none shadow-none focus-visible:ring-0 p-0",
                "text-lg font-medium tracking-wide",
                teko.className
              )}
              autoFocus
            />
          ) : (
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-auto py-1 px-2 gap-1.5 hover:bg-black/5 dark:hover:bg-white/5">
                  <span className={cn("text-lg font-medium tracking-wide max-w-[200px] truncate", teko.className)}>
                    {chat.title}
                  </span>
                  <ChevronDown size={14} className="opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-40">
                <DropdownMenuItem onClick={startRenaming}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-destructive focus:text-destructive"
                  onClick={() => deleteChat.mutate(currentChatId)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
       </div>
    </div>
  )
}