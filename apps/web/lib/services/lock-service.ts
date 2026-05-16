import Redlock, { ExecutionError } from "redlock"
import { redisWriter } from "@/lib/infrastructure/redis"

const isLocalEnvironment = process.env.RDCL_IS_LOCAL === "true" || process.env.DOCKER_LOCAL === "true"

let redlock: Redlock | null = null

if (!isLocalEnvironment) {
  redlock = new Redlock(
    [redisWriter],
    {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
      automaticExtensionThreshold: 500,
    }
  )

  redlock.on("error", (error) => {
    if (error instanceof ExecutionError) {
      return
    }
    console.error("Redlock Error:", error)
  })
}

export class LockService {
  private static instance: LockService

  private constructor() { }

  public static getInstance(): LockService {
    if (!LockService.instance) {
      LockService.instance = new LockService()
    }
    return LockService.instance
  }

  public async execute<T>(
    resources: string | string[],
    task: () => Promise<T>,
    ttl: number = 5000
  ): Promise<T> {
    if (isLocalEnvironment) {
      return task()
    }

    const keys = Array.isArray(resources) ? resources.map(k => `lock:${k}`) : [`lock:${resources}`]

    let lock
    try {
      lock = await redlock!.acquire(keys, ttl)
    } catch {
      throw new Error(`Failed to acquire lock for resources: ${keys.join(", ")}`)
    }

    try {
      return await task()
    } finally {
      try {
        await lock.release()
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.warn(`Failed to release lock for ${keys.join(", ")}`, error)
        }
      }
    }
  }
}

export const lockService = LockService.getInstance()