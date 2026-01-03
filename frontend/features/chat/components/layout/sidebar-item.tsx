"use client"

import { useState } from "react"
import { useChatUIStore } from "../../stores/ui-store"
import { useChatMutations } from "../../hooks/use-chat-mutation"
import { cn } from "@/lib/utils"
import { MoreHorizontal, Trash2, Pencil, Check, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChatHistoryItem } from "../../types"
import { inter } from "@/lib/fonts"

interface SidebarItemProps {
  chat: ChatHistoryItem
}

export const SidebarItem = ({ chat }: SidebarItemProps) => {
  const { currentChatId, setCurrentChatId } = useChatUIStore()
  const { deleteChat, renameChat } = useChatMutations()
  const [isRenaming, setIsRenaming] = useState(false)
  const [newTitle, setNewTitle] = useState(chat.title)

  const isActive = currentChatId === chat.id

  const handleRename = () => {
    if (!newTitle.trim()) {
      setNewTitle(chat.title)
      setIsRenaming(false)
      return
    }
    renameChat.mutate({ id: chat.id, title: newTitle })
    setIsRenaming(false)
  }

  if (isRenaming) {
    return (
      <div className="px-2 py-1">
        <div className="flex items-center gap-1 bg-background border rounded-md px-1 py-1">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="h-6 text-sm border-none shadow-none px-1 focus-visible:ring-0"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename()
              if (e.key === "Escape") setIsRenaming(false)
            }}
          />
          <button onClick={handleRename} className="text-green-500 hover:text-green-600 p-0.5">
            <Check size={14} />
          </button>
          <button onClick={() => setIsRenaming(false)} className="text-red-500 hover:text-red-600 p-0.5">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={() => setCurrentChatId(chat.id)}
      className={cn(
        "group flex items-center justify-between px-3 py-2 mx-2 rounded-lg cursor-pointer transition-colors text-sm mb-1",
        isActive
          ? "bg-secondary/80 text-foreground font-medium"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
        inter.className
      )}
    >
      <span className="truncate flex-1 pr-2">{chat.title}</span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10",
              isActive && "opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation()
            setIsRenaming(true)
          }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation()
              deleteChat.mutate(chat.id)
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}