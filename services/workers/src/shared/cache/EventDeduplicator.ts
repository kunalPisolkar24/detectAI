import { type RedisClient } from "./RedisClient";
import { Logger } from "../logging/Logger";

/**
 * Redis-backed dedup for Paddle payment events.
 * Keys: payment:event:ts:{userId} -> ISO timestamp (no TTL).
 * Requires persistent EventRedis (AOF --appendonly yes + volume) — restart must retain keys
 * or stale events reprocess. Verify: redis-cli INFO persistence shows aof_enabled:1.
 */
export class EventDeduplicator {
  private static readonly DEFAULT_PREFIX = "payment:event:ts:";

  constructor(
    private readonly redis: RedisClient,
    private readonly prefix: string = EventDeduplicator.DEFAULT_PREFIX
  ) {}

  async isStale(userId: string, eventTimestamp: Date): Promise<boolean> {
    try {
      const stored = await this.redis.get(`${this.prefix}${userId}`);
      if (stored && eventTimestamp <= new Date(stored)) {
        Logger.info("Skipping stale event", { userId, eventTimestamp: eventTimestamp.toISOString(), stored });
        return true;
      }
    } catch (error) {
      Logger.warn("Event dedup pre-check failed, proceeding to DB", { userId, error });
    }
    return false;
  }

  async markProcessed(userId: string, eventTimestamp: Date): Promise<void> {
    try {
      await this.redis.set(`${this.prefix}${userId}`, eventTimestamp.toISOString());
    } catch (error) {
      Logger.warn("Failed to set event timestamp in Redis", { userId, error });
    }
  }
}
