import Redlock, { ExecutionError } from "redlock";
import { redis } from "../redis";
import { Logger } from "../logger";

const redlock = new Redlock(
  [redis],
  {
    driftFactor: 0.01,
    retryCount: 3,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500,
  }
);

redlock.on("error", (error: any) => {
  if (error instanceof ExecutionError) {
    return;
  }
  Logger.error("Redlock Client Error", error);
});

export class LockService {
  private static readonly DEFAULT_TTL = 5000;

  static async acquire(key: string, ttl: number = this.DEFAULT_TTL): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`;

    try {
      const lock = await redlock.acquire([lockKey], ttl);

      return async () => {
        try {
          await lock.release();
        } catch (error) {
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