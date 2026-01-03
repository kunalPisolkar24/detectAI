import { IChatService } from "./chat-service.interface"
import { mockChatService } from "./mock-service"
import { env } from "@/lib/env"

const isProduction = env.NODE_ENV === "production"

export const chatService: IChatService = isProduction 
  ? mockChatService 
  : mockChatService