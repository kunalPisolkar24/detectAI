"use client";

import React, { useState } from "react";
import { useChat } from "@/contexts/chatContext";
import { Button } from "@workspace/ui/components/button";
import { Edit, Trash2, MoreHorizontal } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

interface Chat {
  _id: string;
  title: string;
  updatedAt: string;
}

interface ChatItemProps {
  chat: Chat;
}

export const ChatItem: React.FC<ChatItemProps> = ({ chat }) => {
  const { activeChat, setActiveChat, deleteChat, renameChat } = useChat();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = activeChat?._id === chat._id;

  const handleRename = () => {
    const newTitle = prompt("Enter a new title:", chat.title);
    if (newTitle && newTitle.trim() !== chat.title) {
      renameChat(chat._id, newTitle.trim());
    }
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this chat?")) {
      deleteChat(chat._id);
    }
  };

  return (
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
            <DropdownMenuItem onClick={handleRename}>
              <Edit size={14} className="mr-2" />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-red-500 focus:text-red-500 focus:bg-red-500/10"
            >
              <Trash2 size={14} className="mr-2" />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};