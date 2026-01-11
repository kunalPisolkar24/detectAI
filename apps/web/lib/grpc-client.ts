import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"
import { env } from "@/lib/env"

const PROTO_PATH = path.join(process.cwd(), "src/lib/proto/ai_service.proto")

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const aiService = protoDescriptor.aidetection.AIService

let clientInstance: any = null

export const getGrpcClient = () => {
  if (clientInstance) return clientInstance

  const client = new aiService(
    env.AI_SERVICE_URL,
    grpc.credentials.createInsecure()
  )

  if (process.env.NODE_ENV !== "development") {
    clientInstance = client
  }

  return client
}

export const getGrpcMetadata = () => {
  const metadata = new grpc.Metadata()
  metadata.add("x-api-key", env.AI_SERVICE_API_KEY)
  return metadata
}