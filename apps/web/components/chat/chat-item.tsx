"use client";

import React, { useState } from "react";
import { useChat } from "@/contexts/chatContext";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Edit, Trash2, MoreHorizontal } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";

interface Chat {
  _id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatItemProps {
  chat: Chat;
}

export const ChatItem: React.FC<ChatItemProps> = ({ chat }) => {
  const { activeChat, setActiveChat, deleteChat, renameChat } = useChat();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(chat.title);

  const isActive = activeChat?._id === chat._id;

  const handleRename = () => {
    if (newTitle && newTitle.trim() !== "" && newTitle.trim() !== chat.title) {
      renameChat(chat._id, newTitle.trim());
    }
    setIsRenameDialogOpen(false);
  };

  const handleDelete = () => {
    deleteChat(chat._id);
    setIsDeleteDialogOpen(false);
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors w-full",
          isActive ? "bg-primary/10 text-primary" : "hover:bg-muted/50 data-[state=open]:bg-muted/50"
        )}
        onClick={() => setActiveChat(chat)}
        data-state={isMenuOpen ? 'open' : 'closed'}
      >
        <span className="truncate text-sm font-medium">{chat.title}</span>

        <div className={cn("transition-opacity", isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          <DropdownMenu onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                setNewTitle(chat.title);
                setIsRenameDialogOpen(true);
              }}>
                <Edit size={14} className="mr-2" />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeleteDialogOpen(true);
                }}
                className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
              >
                <Trash2 size={14} className="mr-2" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Chat</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new name for this chat. This will not affect the chat content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Label htmlFor="chat-name" className="sr-only">
              Chat Name
            </Label>
            <Input
              id="chat-name"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleRename();
                }
              }}
              placeholder="Enter new title"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRename}>Rename</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this
              chat and all of its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};