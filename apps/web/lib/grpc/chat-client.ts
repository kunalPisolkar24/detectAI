/* eslint-disable @typescript-eslint/no-explicit-any */
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"
import { env } from "@/lib/env"

const PROTO_PATH = path.join(process.cwd(), "lib/proto/chat_service.proto")

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
    if (!GrpcClientFactory.instance) {
      GrpcClientFactory.instance = new ChatServiceProto(
        env.CHAT_SERVICE_URL,
        grpc.credentials.createInsecure(),
        {
          "grpc.keepalive_time_ms": 10000,
          "grpc.keepalive_timeout_ms": 5000,
          "grpc.keepalive_permit_without_calls": 1,
        }
      )
    }
    return GrpcClientFactory.instance
  }
}

export const getChatGrpcClient = () => GrpcClientFactory.getClient()