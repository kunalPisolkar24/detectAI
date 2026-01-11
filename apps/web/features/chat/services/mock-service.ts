import { ChatSession, Message, ModelType, ChatHistoryItem } from "../types"
import { IChatService } from "./chat-service.interface"
import { analyzeText } from "../actions/analyze"

const DELAY_MS = 200

class MockChatService implements IChatService {
  private chats: ChatSession[] = []

  constructor() {
    this.chats = [
      {
        id: "1",
        title: "AI Detection Analysis - Article",
        updatedAt: new Date(),
        messages: []
      }
    ]
  }

  private async delay() {
    return new Promise((resolve) => setTimeout(resolve, DELAY_MS))
  }

  async createChat(initialMessage: string): Promise<ChatSession> {
    const newChat: ChatSession = {
      id: crypto.randomUUID(),
      title: initialMessage.slice(0, 40) || "New Chat",
      messages: [],
      updatedAt: new Date()
    }
    this.chats.unshift(newChat)
    return newChat
  }

  async getChat(chatId: string): Promise<ChatSession> {
    await this.delay()
    const chat = this.chats.find((c) => c.id === chatId)
    if (!chat) throw new Error("Chat session not found")
    return chat
  }

  async getHistory(): Promise<ChatHistoryItem[]> {
    await this.delay()
    return this.chats.map(c => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt
    }))
  }

  async sendMessage(chatId: string, content: string, model: ModelType): Promise<Message> {
    const chat = this.chats.find(c => c.id === chatId)
    if (!chat) throw new Error("Chat not found")

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date()
    }
    chat.messages.push(userMessage)

    const response = await analyzeText(content, model)

    if (!response.success) {
      if (response.isRateLimit) {
        throw new Error("Rate limit exceeded")
      }
      throw new Error(response.error || "Analysis failed")
    }

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      analysis: response.data,
      createdAt: new Date()
    }

    chat.messages.push(assistantMessage)

    return assistantMessage
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.delay()
    this.chats = this.chats.filter(c => c.id !== chatId)
  }

  async renameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem> {
    await this.delay()
    const chat = this.chats.find(c => c.id === chatId)
    if (!chat) throw new Error("Chat not found")
    chat.title = newTitle
    return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt }
  }
}

export const mockChatService = new MockChatService()