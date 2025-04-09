"use client";

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ChatInterface } from "@/components/chat";

export function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const loginSuccess = searchParams.get('login_success');

    if (loginSuccess === 'true') {
      toast.success("Login successful!");
      router.replace('/chat', { scroll: false });
    }
  }, [searchParams, router]);
  return <ChatInterface />;
}