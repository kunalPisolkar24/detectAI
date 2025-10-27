"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface Message {
    _id: string;
    chatId: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
}

interface Chat {
    _id: string;
    userId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

interface AddMessagePayload {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatContextType {
    chats: Chat[];
    activeChat: Chat | null;
    messages: Message[];
    loading: boolean;
    error: string | null;
    fetchChats: () => Promise<void>;
    setActiveChat: (chat: Chat | null) => void;
    startNewChat: () => void;
    createChat: (firstMessageContent: string) => Promise<Chat | undefined>;
    addMessage: (message: AddMessagePayload, targetChat?: Chat | null) => Promise<void>;
    deleteChat: (chatId: string) => Promise<void>;
    renameChat: (chatId: string, newTitle: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
    const [chats, setChats] = useState<Chat[]>([]);
    const [activeChat, setActiveChat] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchChats = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/chat');
            if (!response.ok) throw new Error('Failed to fetch chats.');
            const data: Chat[] = await response.json();
            setChats(data);
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchMessages = useCallback(async (chatId: string) => {
        if (!chatId) {
            setMessages([]);
            return;
        }
        setLoading(true);
        try {
            const response = await fetch(`/api/chat/${chatId}/messages`);
            if (!response.ok) throw new Error('Failed to fetch messages.');
            const data: Message[] = await response.json();
            setMessages(data);
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSetActiveChat = useCallback((chat: Chat | null) => {
        setActiveChat(chat);
        if (chat?._id) {
            fetchMessages(chat._id);
        } else {
            setMessages([]);
        }
    }, [fetchMessages]);

    const startNewChat = () => {
        setActiveChat(null);
        setMessages([]);
    };

    const createChat = async (firstMessageContent: string): Promise<Chat | undefined> => {
        setLoading(true);
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstMessage: firstMessageContent }),
            });
            if (!response.ok) throw new Error('Failed to create chat.');

            const { chat: newChat, firstMessage: newMessage }: { chat: Chat; firstMessage: Message } = await response.json();

            setChats(prev => [newChat, ...prev]);
            setActiveChat(newChat);
            setMessages([newMessage]);

            toast.success("New chat created!");
            return newChat;
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const addMessage = async (message: AddMessagePayload, targetChatOverride?: Chat | null) => {
        const currentTargetChat = targetChatOverride || activeChat;

        if (!currentTargetChat?._id) {
            toast.error("Could not send message: no active chat.");
            return;
        };

        try {
            const response = await fetch(`/api/chat/${currentTargetChat._id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message),
            });
            if (!response.ok) throw new Error('Failed to add message.');
            const newMessage: Message = await response.json();
            setMessages(prev => [...prev, newMessage]);
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        }
    };

    const deleteChat = async (chatId: string) => {
        try {
            const response = await fetch(`/api/chat/${chatId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete chat.');

            setChats(prev => prev.filter(c => c._id !== chatId));
            if (activeChat?._id === chatId) {
                startNewChat();
            }
            toast.success("Chat deleted successfully.");
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        }
    };

    const renameChat = async (chatId: string, newTitle: string) => {
        try {
            const response = await fetch(`/api/chat/${chatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle }),
            });
            if (!response.ok) throw new Error('Failed to rename chat.');
            const updatedChat: Chat = await response.json();

            setChats(prev => prev.map(c => (c._id === chatId ? updatedChat : c)));
            if (activeChat?._id === chatId) {
                setActiveChat(updatedChat);
            }
            toast.success("Chat renamed.");
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        }
    };

    useEffect(() => {
        fetchChats();
    }, [fetchChats]);

    const value = {
        chats,
        activeChat,
        messages,
        loading,
        error,
        fetchChats,
        setActiveChat: handleSetActiveChat,
        startNewChat,
        createChat,
        addMessage,
        deleteChat,
        renameChat,
    };

    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = (): ChatContextType => {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
};