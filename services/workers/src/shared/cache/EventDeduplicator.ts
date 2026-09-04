import { type RedisClient } from "./RedisClient";
import { Logger } from "../logging/Logger";

/**
 * Redis-backed ordering for Paddle payment events.
 * Keys: payment:event:ts:{userId} -> ISO timestamp with 30d TTL (2592000s).
 * Requires persistent EventRedis (AOF --appendonly yes + volume) — restart must retain keys
 * or stale events reprocess. 30d bounds memory to active users last 30d (monthly cycle);
 * DB lockAndUpdateSubscription remains authoritative after expiry. Verify: redis-cli INFO persistence shows aof_enabled:1.
 */
export class EventDeduplicator {
  private static readonly DEFAULT_PREFIX = "payment:event:ts:";
  private static readonly TTL_SECONDS = 30 * 24 * 60 * 60; // 30d = 2592000

  constructor(
    private readonly redis: RedisClient,
    private readonly prefix: string = EventDeduplicator.DEFAULT_PREFIX
  ) {}

  async isStale(userId: string, eventTimestamp: Date): Promise<boolean> {
    if (!userId || !userId.trim()) {
      Logger.warn("Event dedup called with empty userId", { userId });
      return false;
    }
    if (!(eventTimestamp instanceof Date) || isNaN(eventTimestamp.getTime())) {
      Logger.warn("Event dedup called with invalid timestamp", { userId, eventTimestamp });
      return false;
    }
    try {
      const stored = await this.redis.get(`${this.prefix}${userId}`);
      if (!stored) return false;
      const storedDate = new Date(stored);
      if (isNaN(storedDate.getTime())) {
        Logger.warn("Event dedup stored value is invalid date, ignoring", { userId, stored });
        return false;
      }
      // Use < for same-timestamp distinct events (tolerant), DB lockAndUpdateSubscription is authoritative
      if (eventTimestamp < storedDate) {
        Logger.info("Skipping stale event", { userId, eventTimestamp: eventTimestamp.toISOString(), stored });
        return true;
      }
      // Equal timestamps are not considered stale here; allow DB to decide ordering
      return false;
    } catch (error) {
      Logger.warn("Event dedup pre-check failed, proceeding to DB", { userId, error });
    }
    return false;
  }

  async markProcessed(userId: string, eventTimestamp: Date): Promise<void> {
    if (!userId || !userId.trim()) return;
    if (!(eventTimestamp instanceof Date) || isNaN(eventTimestamp.getTime())) return;
    const key = `${this.prefix}${userId}`;
    const value = eventTimestamp.toISOString();
    try {
      // Try atomic CAS via Lua if available (ioredis), otherwise fallback to SET
      const maybeEval = (this.redis as any).eval;
      if (typeof maybeEval === "function") {
        // Lua: only SET if not exists or new > stored (lexicographic ISO)
        const script = `
          local stored = redis.call('GET', KEYS[1])
          if not stored or ARGV[1] > stored then
            redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
            return 1
          else
            return 0
          end
        `;
        try {
          await (this.redis as any).eval(script, 1, key, value, String(EventDeduplicator.TTL_SECONDS));
          return;
        } catch {
          // Fallback to simple SET if eval fails (e.g., cluster)
        }
      }
      await this.redis.set(key, value, "EX", EventDeduplicator.TTL_SECONDS);
    } catch (error) {
      Logger.warn("Failed to set event timestamp in Redis", { userId, error });
    }
  }
}
