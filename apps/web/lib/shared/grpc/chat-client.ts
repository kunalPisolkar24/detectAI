/* eslint-disable @typescript-eslint/no-explicit-any */
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"
import { env } from "@/lib/config/env"

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

const PROTO_PATH = path.join(process.cwd(), "lib/shared/proto/chat_service.proto")

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
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
      GrpcClientFactory.instance = new ChatServiceProto(
        env.CHAT_SERVICE_URL,
        grpc.credentials.createInsecure(),
        {
          "grpc.keepalive_time_ms": 60000,
          "grpc.keepalive_timeout_ms": 5000,
          "grpc.keepalive_permit_without_calls": 1,
        }
      )
    }
    return GrpcClientFactory.instance
  }
}

export const getChatGrpcClient = () => GrpcClientFactory.getClient()