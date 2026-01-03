"use client"

import { useState } from "react"
import { useChatUIStore } from "../../stores/ui-store"
import { useChatMutations } from "../../hooks/use-chat-mutation"
import { cn } from "@/lib/utils"
import { MoreHorizontal, Trash2, Pencil } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
import { ChatHistoryItem } from "../../types"
import { inter } from "@/lib/fonts"

interface SidebarItemProps {
  chat: ChatHistoryItem
}

export const SidebarItem = ({ chat }: SidebarItemProps) => {
  const { currentChatId, setCurrentChatId } = useChatUIStore()
  const { deleteChat, renameChat } = useChatMutations()
  
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [newTitle, setNewTitle] = useState(chat.title)

  const isActive = currentChatId === chat.id

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault()
    if (newTitle.trim() && newTitle !== chat.title) {
      renameChat.mutate({ id: chat.id, title: newTitle.trim() })
    }
    setShowRenameDialog(false)
  }

  const handleDelete = () => {
    deleteChat.mutate(chat.id)
    setShowDeleteDialog(false)
  }

  return (
    <>
      <div
        onClick={() => setCurrentChatId(chat.id)}
        className={cn(
          "group flex items-center justify-between px-3 py-2 mx-2 rounded-lg cursor-pointer transition-all duration-200 text-sm mb-1",
          isActive 
            ? "bg-secondary text-foreground font-medium shadow-sm" 
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
          inter.className
        )}
      >
        <span className="truncate flex-1 pr-2">{chat.title}</span>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded-md hover:bg-black/10 dark:hover:bg-white/10",
                isActive && "opacity-100"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem 
              onClick={(e) => {
                e.stopPropagation()
                setNewTitle(chat.title)
                setShowRenameDialog(true)
              }}
            >
              <Pencil className="mr-2 h-4 w-4 opacity-70" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={(e) => {
                e.stopPropagation()
                setShowDeleteDialog(true)
              }}
              className="text-red-600 dark:text-red-400 focus:text-red-600 dark:focus:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/20"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          <form onSubmit={handleRename}>
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
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={!newTitle.trim()}>
                Save Changes
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600 dark:border-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}