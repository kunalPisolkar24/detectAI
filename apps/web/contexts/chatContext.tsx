"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

interface ChatContextType {
    chats: any[];
    activeChat: any | null;
    messages: any[];
    loading: boolean;
    error: string | null;
    fetchChats: () => Promise<void>;
    setActiveChat: (chat: any | null) => void;
    startNewChat: () => void;
    createChat: (firstMessage: string) => Promise<any>;
    addMessage: (message: { role: 'user' | 'assistant', content: string }) => Promise<void>;
    deleteChat: (chatId: string) => Promise<void>;
    renameChat: (chatId: string, newTitle: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
    const [chats, setChats] = useState<any[]>([]);
    const [activeChat, setActiveChat] = useState<any | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchChats = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/chat');
            if (!response.ok) throw new Error('Failed to fetch chats.');
            const data = await response.json();
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
            const data = await response.json();
            setMessages(data);
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSetActiveChat = useCallback((chat: any | null) => {
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

    const createChat = async (firstMessage: string) => {
        setLoading(true);
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstMessage }),
            });
            if (!response.ok) throw new Error('Failed to create chat.');
            const newChat = await response.json();

            await fetchChats();
            handleSetActiveChat(newChat);
            toast.success("New chat created!");
            return newChat;
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    const addMessage = async (message: { role: 'user' | 'assistant', content: string }) => {
        if (!activeChat?._id) return;
        setLoading(true);
        try {
            const response = await fetch(`/api/chat/${activeChat._id}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message),
            });
            if (!response.ok) throw new Error('Failed to add message.');
            const newMessage = await response.json();
            setMessages(prev => [...prev, newMessage]);
        } catch (err: any) {
            setError(err.message);
            toast.error(err.message);
        } finally {
            setLoading(false);
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
            const updatedChat = await response.json();

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

export const useChat = () => {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
};