"use client";

import React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
} from "@workspace/ui/components/sidebar";
import { Button } from "@workspace/ui/components/button";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { PlusCircle } from "lucide-react";
import { useChat } from "@/contexts/chatContext";
import { ChatItem } from "./chat-item";
import { Skeleton } from "@workspace/ui/components/skeleton";

export const AppSidebar = () => {
  const { chats, startNewChat, loading } = useChat();

  return (
    <Sidebar className="h-screen flex flex-col md:w-72 lg:w-80 p-2 border-r">
      <SidebarHeader>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={startNewChat}
        >
          <PlusCircle size={16} />
          <span>New Chat</span>
        </Button>
      </SidebarHeader>

      <SidebarContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full w-full">
          <SidebarGroup className="p-2">
            {loading && chats.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ) : chats.length > 0 ? (
              chats.map((chat) => (
                <ChatItem key={chat._id} chat={chat} />
              ))
            ) : (
              !loading && (
                <p className="text-sm text-center text-muted-foreground pt-4">
                  No chats yet.
                </p>
              )
            )}
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
};