"use client";

import React from "react";
import { ChatNav } from "@/components/chat";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { TabProvider } from "@/contexts/tabContext";
import { ChatProvider } from "@/contexts/chatContext";
import { SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar";

const ChatLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ChatProvider>
      <TabProvider>
        <SidebarProvider>
          <section className="w-full min-h-screen flex bg-background">
            <AppSidebar />
            <div className="flex-1 flex flex-col h-screen">
              <ChatNav />
              <main className="relative flex-1 flex h-[calc(100vh-var(--header-height,80px))]">
                <div className="absolute top-4 left-4 z-10 md:hidden">
                  <SidebarTrigger />
                </div>
                <div className="flex-1 w-full h-full">
                  {children}
                </div>
              </main>
            </div>
          </section>
        </SidebarProvider>
      </TabProvider>
    </ChatProvider>
  );
};

export default ChatLayout;