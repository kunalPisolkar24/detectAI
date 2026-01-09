import { redis } from "../redis";

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_MS = 100;
const MAX_RETRIES = 20;

export class LockService {
  static async acquire(key: string): Promise<(() => Promise<void>) | null> {
    const lockKey = `lock:${key}`;
    const token = crypto.randomUUID();

    for (let i = 0; i < MAX_RETRIES; i++) {
      const acquired = await redis.set(lockKey, token, "PX", LOCK_TTL_MS, "NX");

      if (acquired === "OK") {
        return async () => {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await redis.eval(script, 1, lockKey, token);
        };
      }

      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }

    return null;
  }
}