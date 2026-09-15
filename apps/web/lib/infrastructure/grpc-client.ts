import * as grpc from "@grpc/grpc-js"
import { env } from "@/lib/config/env"
import { isPreviewMode } from "@/lib/config/preview"
import { loadProto, grpcKeepalive } from "./grpc-loader"

const protoDescriptor = loadProto("lib/shared/proto/ai_service.proto")
const AIService = protoDescriptor.aidetection.AIService

class GrpcClient {
  private static instance: GrpcClient
  private client: any

  private constructor() {
    if (isPreviewMode()) {
      this.client = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") return undefined
            return (...args: unknown[]) => {
              const cb = args[args.length - 1]
              if (typeof cb === "function") {
                ;(cb as any)(new Error("AI service not available in preview mode"))
              }
              // Return mock stream object for streaming calls
              return {
                on: () => {},
                cancel: () => {},
              }
            }
          },
        },
      )
      return
    }
    this.client = new AIService(env.AI_SERVICE_URL, grpc.credentials.createInsecure(), grpcKeepalive)
  }

  public static getInstance(): any {
    if (!GrpcClient.instance) {
      GrpcClient.instance = new GrpcClient()
    }
    return GrpcClient.instance.client
  }
}

export const getGrpcClient = () => GrpcClient.getInstance()

export const getGrpcMetadata = () => {
  if (isPreviewMode()) return new grpc.Metadata()
  const metadata = new grpc.Metadata()
  metadata.add("x-api-key", env.AI_SERVICE_API_KEY)
  return metadata
}