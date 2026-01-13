import { IChatService } from "./chat-service.interface"
import { GrpcChatService } from "./grpc-chat-service"

export const chatService: IChatService = new GrpcChatService()