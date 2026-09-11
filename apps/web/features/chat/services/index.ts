import { IChatService } from "./chat-service.interface"
import { GrpcChatService } from "./grpc-chat-service"
import { MockChatService } from "./mock-chat-service"
import { isPreviewMode } from "@/lib/config/preview"

export const chatService: IChatService = isPreviewMode() ? new MockChatService() : new GrpcChatService()