"use client"

import { useChatUIStore } from "../../stores/ui-store"
import { useChatSession } from "../../hooks/use-chat-history"
import { useChatMutations } from "../../hooks/use-chat-mutation"
import { cn } from "@/lib/core/utils"
import { teko, inter } from "@/lib/core/fonts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ChevronDown, Trash2, Pencil } from "lucide-react"
import { useState } from "react"
import { Input } from "@/components/ui/input"

export const ChatHeader = () => {
  const { currentChatId } = useChatUIStore()
  const { data: chat } = useChatSession(currentChatId)
  const { deleteChat, renameChat } = useChatMutations()

  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [newTitle, setNewTitle] = useState("")

  if (!currentChatId || !chat) return null

  const handleRenameOpen = () => {
    setNewTitle(chat.title)
    setShowRenameDialog(true)
  }

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newTitle.trim() && newTitle !== chat.title) {
      renameChat.mutate({ id: currentChatId, title: newTitle.trim() })
    }
    setShowRenameDialog(false)
  }

  const handleDelete = () => {
    deleteChat.mutate(currentChatId)
    setShowDeleteDialog(false)
  }

  return (
    <>
      <div className="hidden md:flex w-full h-14 shrink-0 border-b border-black/5 dark:border-white/5 bg-background items-center px-4 md:px-6">
        <div className="flex-1 flex justify-start">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-3 gap-2 hover:bg-secondary/80 data-[state=open]:bg-secondary/80 transition-all rounded-lg group"
              >
                <span className={cn(
                  "text-sm font-medium tracking-normal max-w-[300px] truncate text-foreground/90 group-hover:text-foreground",
                  inter.className
                )}>
                  {chat.title}
                </span>
                <ChevronDown size={14} className="opacity-50 group-hover:opacity-100 transition-opacity" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 mt-1">
              <DropdownMenuItem onClick={handleRenameOpen}>
                <Pencil className="mr-2 h-4 w-4 opacity-70" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/20"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Rename Dialog */}
      <AlertDialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Chat</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new name for this conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form onSubmit={handleRenameSubmit}>
            <div className="py-4">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Chat title"
                className="w-full"
                autoFocus
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel type="button" className={cn("text-base tracking-wide", teko.className)}>
                CANCEL
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                disabled={!newTitle.trim()}
                className={cn("bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0 tracking-wide text-lg", teko.className)}
              >
                SAVE
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-medium text-foreground">&quot;{chat.title}&quot;</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={cn("text-base tracking-wide", teko.className)}>CANCEL</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className={cn("bg-red-600 hover:bg-red-700 text-white border-red-600 dark:border-red-600 tracking-wide text-lg", teko.className)}
            >
              DELETE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}