import { IChatService } from "./chat-service.interface"
import { mockChatService } from "./mock-service"

const isProduction = process.env.NODE_ENV === "production"

export const chatService: IChatService = isProduction 
  ? mockChatService 
  : mockChatService