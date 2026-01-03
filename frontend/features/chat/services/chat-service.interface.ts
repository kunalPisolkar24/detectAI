import { ChatSession, Message, ModelType, ChatHistoryItem } from "../types"

export interface IChatService {
  createChat(initialMessage: string): Promise<ChatSession>
  getChat(chatId: string): Promise<ChatSession>
  getHistory(): Promise<ChatHistoryItem[]>
  sendMessage(chatId: string, content: string, model: ModelType): Promise<Message>
  deleteChat(chatId: string): Promise<void>
  renameChat(chatId: string, newTitle: string): Promise<ChatHistoryItem>
}