"use client";

import { ChatNav } from "@/components/chat";
import { TabProvider } from "@/contexts/tabContext";

const Chatlayout = ({ children }: any) => {
  return (
    <TabProvider>
      <section className="w-full min-h-screen flex flex-col bg-gray-100 dark:bg-background">
        <ChatNav />
        <main className="flex-1">{children}</main>
      </section>
    </TabProvider>
  );
};

export default Chatlayout;
