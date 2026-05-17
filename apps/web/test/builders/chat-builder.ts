import { ChatSession, Message, ChatHistoryItem } from "@/features/chat/types"

export const createMessage = (overrides: Partial<Message> = {}): Message => ({
  id: `msg-${Math.random().toString(36).substring(7)}`,
  role: "user",
  content: "Test message content",
  createdAt: new Date(),
  ...overrides,
})

export const createChatSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: `chat-${Math.random().toString(36).substring(7)}`,
  title: "New Chat",
  messages: [],
  updatedAt: new Date(),
  ...overrides,
})

export const createChatHistoryItem = (overrides: Partial<ChatHistoryItem> = {}): ChatHistoryItem => ({
  id: `chat-${Math.random().toString(36).substring(7)}`,
  title: "Chat History Item",
  updatedAt: new Date(),
  ...overrides,
})
