import { ChatSession, Message, ModelType } from "../types"

export interface IChatService {
  createChat(initialMessage: string): Promise<ChatSession>
  getChat(chatId: string): Promise<ChatSession>
  sendMessage(chatId: string, content: string, model: ModelType): Promise<Message>
}