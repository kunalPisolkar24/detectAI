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
    if (!eventId || typeof eventId !== "string" || !eventId.trim()) {
      Logger.warn("Idempotency check with empty eventId", { eventId });
      // Treat empty as not duplicate to avoid cross-contamination, but caller should validate
      return false;
    }
    const key = `${IdempotencyStore.PREFIX}${eventId}`;
    try {
      const result = await this.redis.set(
        key,
        "1",
        "EX",
        IdempotencyStore.TTL_SECONDS,
        "NX",
      );
      // ioredis returns "OK" on success, null on NX failure; cluster may return 1
      const isNew = result === "OK" || (result as unknown) === 1;
      if (!isNew) {
        // result === null => already exists -> duplicate
        if (result === null) {
          return true;
        }
        // Fallback: treat any other truthy as not duplicate
        return false;
      }
      // Claimed in Redis — now check DB for 7d-expiry / 90d replay window.
      // If DB already has this eventId, treat as duplicate even though Redis expired.
      try {
        const existing = await (this.prisma as any).processedWebhook.findUnique({
          where: { eventId },
        });
        if (existing) {
          return true;
        }
      } catch (dbError) {
        Logger.warn("Idempotency DB check after claim failed", { eventId, error: dbError });
        // Keep claim — don't block processing on DB check failure
      }
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

  async release(eventId: string): Promise<void> {
    if (!eventId || typeof eventId !== "string" || !eventId.trim()) return;
    try {
      await this.redis.del(`${IdempotencyStore.PREFIX}${eventId}`);
    } catch (error) {
      Logger.warn("Failed to release idempotency claim", { eventId, error });
    }
  }

  // For crash-after-claim safety: persist to DB after successful processing
  async markProcessed(eventId: string, eventType: string): Promise<void> {
    if (!eventId || !eventId.trim()) return;
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
      try {
        this.metrics?.jobErrors?.inc({ job_type: "idempotency_persist", error_type: "db_error" } as any);
      } catch {}
      // Do not throw for now — ledger gap is serious but should not NACK the original success.
      // Future: rethrow to trigger retry/DLQ for persistence failures.
    }
  }
}
