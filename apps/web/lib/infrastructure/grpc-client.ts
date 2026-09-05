/* eslint-disable @typescript-eslint/no-explicit-any */
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"
import { env } from "@/lib/config/env"

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

const PROTO_PATH = path.join(process.cwd(), "lib/shared/proto/ai_service.proto")

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
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
    this.client = new AIService(
      env.AI_SERVICE_URL,
      grpc.credentials.createInsecure(),
      {
        "grpc.keepalive_time_ms": 60000,
        "grpc.keepalive_timeout_ms": 5000,
        "grpc.keepalive_permit_without_calls": 1,
      }
    )
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