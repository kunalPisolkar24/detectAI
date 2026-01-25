import Redlock, { ExecutionError } from "redlock";
import { type RedisClient } from "../redis";
import { Logger } from "../logger";

export class LockService {
  private redlock: Redlock;
  private static readonly DEFAULT_TTL = 5000;

  constructor(client: RedisClient) {
    this.redlock = new Redlock(
      [client],
      {
        driftFactor: 0.01,
        retryCount: 3,
        retryDelay: 200,
        retryJitter: 200,
        automaticExtensionThreshold: 500,
      }
    );

    this.redlock.on("error", (error: any) => {
      if (error instanceof ExecutionError) {
        return;
      }
      Logger.error("Redlock Client Error", error);
    });
  }

  async acquire(key: string, ttl: number = LockService.DEFAULT_TTL): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`;

    try {
      const lock = await this.redlock.acquire([lockKey], ttl);

      return async () => {
        try {
          await lock.release();
        } catch (error) {
          if (error instanceof ExecutionError) {
             return;
          }
          Logger.warn(`Failed to release lock for ${key}`, { error });
        }
      };
    } catch (error) {
      if (error instanceof ExecutionError) {
        return null;
      }
      
      Logger.error(`Failed to acquire lock for ${key}`, error);
      return null;
    }
  }
}