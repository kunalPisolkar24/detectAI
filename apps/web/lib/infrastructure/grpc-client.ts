/* eslint-disable @typescript-eslint/no-explicit-any */
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"
import { env } from "@/lib/config/env"

const PROTO_PATH = path.join(process.cwd(), "lib/proto/ai_service.proto")

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
    this.client = new AIService(
      env.AI_SERVICE_URL,
      grpc.credentials.createInsecure(),
      {
        "grpc.keepalive_time_ms": 10000,
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
  const metadata = new grpc.Metadata()
  metadata.add("x-api-key", env.AI_SERVICE_API_KEY)
  return metadata
}