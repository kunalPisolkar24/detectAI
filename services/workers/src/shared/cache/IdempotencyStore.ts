import { type RedisClient } from "./RedisClient";
import { Logger } from "../logging/Logger";
import { type MetricsService } from "../monitoring/MetricsService";
import { type PrismaClient } from "../../../generated/prisma/client";

/**
 * Permanent DB ledger + 7d Redis fast path for Paddle event_id dedup.
 * Keys: paddle:evt:{eventId} -> "1" with EX 604800 NX (atomic).
 * DB ProcessedWebhook is authoritative for 90d manual replay window.
 * Fail-open on Redis error: fallback to DB findUnique, warn and inc metric.
 */
export class IdempotencyStore {
  private static readonly PREFIX = "paddle:evt:";
  private static readonly TTL_SECONDS = 7 * 24 * 60 * 60; // 604800 = 7d

  constructor(
    private readonly redis: RedisClient,
    private readonly prisma: PrismaClient,
    private readonly metrics?: MetricsService,
  ) {}

  async isDuplicate(eventId: string): Promise<boolean> {
    try {
      const result = await this.redis.set(
        `${IdempotencyStore.PREFIX}${eventId}`,
        "1",
        "EX",
        IdempotencyStore.TTL_SECONDS,
        "NX",
      );
      // ioredis returns "OK" on success, null on NX failure; cluster may return 1
      const isNew = result === "OK" || (result as unknown) === 1;
      if (isNew) {
        return false;
      }
      // result === null => already exists -> duplicate
      if (result === null) {
        return true;
      }
      // Fallback: treat any other truthy as not duplicate
      return false;
    } catch (error) {
      Logger.warn("Idempotency Redis check failed, fallback to DB", { eventId, error });
      try {
        this.metrics?.workerIdempotencyRedisErrorsTotal.inc();
      } catch {}
      try {
        const existing = await (this.prisma as any).processedWebhook.findUnique({
          where: { eventId },
        });
        return !!existing;
      } catch (dbError) {
        Logger.warn("Idempotency DB fallback failed, fail-open", { eventId, error: dbError });
        return false;
      }
    }
  }

  // For crash-after-claim safety: persist to DB after successful processing
  async markProcessed(eventId: string, eventType: string): Promise<void> {
    try {
      await (this.prisma as any).processedWebhook.create({
        data: { eventId, eventType },
      });
    } catch (error: any) {
      // Unique constraint violation means duplicate already persisted (race) — ignore
      if (error?.code === "P2002" || String(error?.message).includes("Unique constraint")) {
        return;
      }
      Logger.warn("Failed to persist ProcessedWebhook", { eventId, eventType, error });
    }
  }
}
