"use client"

import { useChatUIStore } from "../../stores/ui-store"
import { useChatHistory, useChatSession } from "../../hooks/use-chat-history"
import { useChatMutations } from "../../hooks/use-chat-mutation"
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { 
  Menu, 
  CircleFadingPlus, 
  BotIcon, 
  ChevronDown, 
  Pencil, 
  Trash2 
} from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { SidebarItem } from "./sidebar-item"
import { UserMenu } from "./user-menu"
import { cn } from "@/lib/utils"
import { teko, inter } from "@/lib/fonts"
import { useState } from "react"

export const MobileHeader = () => {
  const { currentChatId, setCurrentChatId } = useChatUIStore()
  const { data: history } = useChatHistory()
  const { data: chat } = useChatSession(currentChatId)
  const { deleteChat, renameChat } = useChatMutations()
  
  const [isOpen, setIsOpen] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [newTitle, setNewTitle] = useState("")

  const handleNewChat = () => {
    setCurrentChatId(null)
    setIsOpen(false)
  }

  const handleRenameOpen = () => {
    if (chat) {
      setNewTitle(chat.title)
      setShowRenameDialog(true)
    }
  }

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (chat && newTitle.trim() && newTitle !== chat.title) {
      renameChat.mutate({ id: chat.id, title: newTitle.trim() })
    }
    setShowRenameDialog(false)
  }

  const handleDelete = () => {
    if (chat) {
      deleteChat.mutate(chat.id)
      setShowDeleteDialog(false)
    }
  }

  return (
    <>
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
                  <CircleFadingPlus size={18} />
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

        <div className="flex-1 flex justify-center overflow-hidden px-2">
          {chat ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-auto py-1 px-2 gap-1.5 hover:bg-secondary/50 max-w-full"
                >
                  <span className={cn("text-sm font-medium truncate", inter.className)}>
                    {chat.title}
                  </span>
                  <ChevronDown size={14} className="opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48">
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
          ) : (
            <span className={cn("text-xl font-medium pt-1", teko.className)}>Detect AI</span>
          )}
        </div>

        <Button variant="ghost" size="icon" onClick={() => setCurrentChatId(null)} className="-mr-2">
          <CircleFadingPlus size={20} />
        </Button>
      </header>

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
              This will permanently delete <span className="font-medium text-foreground">&quot;{chat?.title}&quot;</span>. This action cannot be undone.
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