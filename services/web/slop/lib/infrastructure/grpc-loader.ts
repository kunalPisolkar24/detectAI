import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"

export const grpcKeepalive = {
  "grpc.keepalive_time_ms": 60000,
  "grpc.keepalive_timeout_ms": 5000,
  "grpc.keepalive_permit_without_calls": 1 as const,
}

export function loadProto(relativePath: string) {
  const protoPath = path.join(process.cwd(), relativePath)
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  return grpc.loadPackageDefinition(definition) as any
}
