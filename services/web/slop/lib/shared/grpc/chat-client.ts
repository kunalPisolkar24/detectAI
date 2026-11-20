import * as grpc from "@grpc/grpc-js"
import { env } from "@/lib/config/env"
import { isPreviewMode } from "@/lib/config/preview"
import { loadProto, grpcKeepalive } from "@/lib/infrastructure/grpc-loader"

const protoDescriptor = loadProto("lib/shared/proto/chat_service.proto")
const ChatServiceProto = protoDescriptor.chat.ChatService

class GrpcClientFactory {
  private static instance: any

  public static getClient() {
    if (isPreviewMode()) {
      if (!GrpcClientFactory.instance) {
        GrpcClientFactory.instance = new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "then") return undefined
              return (...args: unknown[]) => {
                const cb = args[args.length - 1]
                if (typeof cb === "function") {
                  ;(cb as any)(new Error("Chat service not available in preview mode"))
                }
              }
            },
          },
        )
      }
      return GrpcClientFactory.instance
    }
    if (!GrpcClientFactory.instance) {
      GrpcClientFactory.instance = new ChatServiceProto(env.CHAT_SERVICE_URL, grpc.credentials.createInsecure(), grpcKeepalive)
    }
    return GrpcClientFactory.instance
  }
}

export const getChatGrpcClient = () => GrpcClientFactory.getClient()

// Identity for chat-service RPCs. The server requires the x-user-id header
// on RPCs whose proto has no user_id field (GetChat, GetChatHistory,
// RenameChat, DeleteChat) and prefers it everywhere else — pass it on every
// call so new RPCs are authenticated by default.
export const buildUserMetadata = (userId: string) => {
  const md = new grpc.Metadata()
  md.set("x-user-id", userId)
  return md
}