import { IChatService } from "./chat-service.interface"
import { GrpcChatService } from "./grpc-chat-service"
import { MockChatService } from "./mock-chat-service"

const isPreviewMode = () => process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

export const chatService: IChatService = isPreviewMode() ? new MockChatService() : new GrpcChatService()