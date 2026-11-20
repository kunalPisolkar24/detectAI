import * as grpc from "@grpc/grpc-js"
import { loadProto, grpcKeepalive } from "./grpc-loader"

type HealthResult = { ok: boolean; latencyMs?: number; error?: string }

function getHealthClient(target: string): any {
  const descriptor = loadProto("lib/shared/proto/grpc_health.proto")
  const Health = descriptor.grpc.health.v1.Health
  return new Health(target, grpc.credentials.createInsecure(), grpcKeepalive)
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
