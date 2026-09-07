/* eslint-disable @typescript-eslint/no-explicit-any */
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import path from "path"

type HealthResult = { ok: boolean; latencyMs?: number; error?: string }

let healthPackageDef: protoLoader.PackageDefinition | null = null

function getHealthPackageDef(): protoLoader.PackageDefinition {
  if (!healthPackageDef) {
    const protoPath = path.join(process.cwd(), "lib/shared/proto/grpc_health.proto")
    healthPackageDef = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    })
  }
  return healthPackageDef
}

function getHealthClient(target: string): any {
  const def = getHealthPackageDef()
  const descriptor = grpc.loadPackageDefinition(def) as any
  const Health = descriptor.grpc.health.v1.Health
  return new Health(target, grpc.credentials.createInsecure(), {
    "grpc.keepalive_time_ms": 60000,
    "grpc.keepalive_timeout_ms": 5000,
  })
}

/**
 * Probes a gRPC health endpoint (`grpc.health.v1.Health/Check`) for `service`.
 * 2s deadline, closes the channel after the call to avoid leaking connections.
 * Returns ok=true only when status === SERVING (1).
 */
export async function checkGrpcHealth(
  target: string,
  service: string,
  timeoutMs = 2000,
): Promise<HealthResult> {
  const start = performance.now()
  const client = getHealthClient(target)
  const deadline = new Date(Date.now() + timeoutMs)

  try {
    const response: any = await new Promise((resolve, reject) => {
      client.Check({ service }, { deadline }, (err: Error | null, res: any) => {
        if (err) reject(err)
        else resolve(res)
      })
    })

    // Proto-loader with enums:String → "SERVING", otherwise 1.
    const status = response?.status
    const serving = status === "SERVING" || status === 1
    if (!serving) return { ok: false, error: `health ${status ?? "UNKNOWN"}` }
    return { ok: true, latencyMs: Math.round(performance.now() - start) }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  } finally {
    try {
      client.close()
    } catch {}
  }
}
