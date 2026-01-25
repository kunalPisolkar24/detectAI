declare module "redlock" {
    import { Redis, Cluster } from "ioredis"
  
    export class ExecutionError extends Error {}
  
    export interface RedlockOptions {
      driftFactor?: number
      retryCount?: number
      retryDelay?: number
      retryJitter?: number
      automaticExtensionThreshold?: number
    }
  
    export interface Lock {
      release(): Promise<void>
    }
  
    export default class Redlock {
      constructor(clients: (Redis | Cluster)[], options?: RedlockOptions)
      
      on(event: "error", handler: (error: any) => void): this
      
      acquire(resources: string[], duration: number): Promise<Lock>
      
      using<T>(
        resources: string[],
        duration: number,
        routine: (signal: AbortSignal) => Promise<T>
      ): Promise<T>
    }
  }