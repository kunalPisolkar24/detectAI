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
import { ScrollArea, ScrollBar } from "@workspace/ui/components/scroll-area";
import { PlusCircle } from "lucide-react";
import { useChat } from "@/contexts/chatContext";
import { ChatItem } from "./chat-item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Logo } from "@/components/common";
import { cn } from "@workspace/ui/lib/utils";

export const AppSidebar = () => {
  const { chats, startNewChat, loading } = useChat();

  return (
    <Sidebar className="h-screen hidden md:flex flex-col p-2 border-r z-50 bg-background">
      <SidebarHeader className="flex items-center justify-between p-2">
        <div className="md:data-[collapsed=true]:hidden">
          <Logo />
        </div>
      </SidebarHeader>

      <div className="p-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={startNewChat}
        >
          <PlusCircle size={16} />
          <span className="md:data-[collapsed=true]:hidden">New Chat</span>
        </Button>
      </div>

      <SidebarContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full w-full">
          <SidebarGroup
            className={cn("p-2", "md:data-[collapsed=true]:pt-0 md:data-[collapsed=true]:px-0.5")}
          >
            <span className="text-xs text-muted-foreground font-semibold uppercase md:data-[collapsed=true]:hidden">
              Recent Chats
            </span>

            {loading && chats.length === 0 ? (
              <div className="space-y-2 mt-2">
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ) : chats.length > 0 ? (
              <div className="mt-2 space-y-1">
                {chats.map((chat) => (
                  <ChatItem key={chat._id} chat={chat} />
                ))}
              </div>
            ) : (
              !loading && (
                <p className="text-sm text-center text-muted-foreground pt-4 md:data-[collapsed=true]:hidden">
                  No chats yet.
                </p>
              )
            )}
          </SidebarGroup>
          <ScrollBar orientation="vertical" className="w-1.5" />
        </ScrollArea>
      </SidebarContent>

      <SidebarFooter>
      </SidebarFooter>
    </Sidebar>
  );
};