"use client";
import React from "react";
import { ChatNav } from "@/components/chat";
import { AppSidebar } from "@/components/chat/app-sidebar";
import { TabProvider } from "@/contexts/tabContext";
import { ChatProvider } from "@/contexts/chatContext";
import { SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar";
import { PanelLeft } from "lucide-react";

const ChatLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ChatProvider>
      <TabProvider>
        <SidebarProvider>
          <section className="w-full min-h-screen flex bg-background">
            
            <AppSidebar />
            <div className="fixed top-4 left-4 z-50 md:hidden">
              <SidebarTrigger>
                <PanelLeft size={18} />
              </SidebarTrigger>
            </div>
            
            <div className="flex-1 flex flex-col h-screen">
              <ChatNav />
              <main className="flex-1 w-full h-full">
                {children}
              </main>
            </div>
            
          </section>
        </SidebarProvider>
      </TabProvider>
    </ChatProvider>
  );
};

export default ChatLayout;