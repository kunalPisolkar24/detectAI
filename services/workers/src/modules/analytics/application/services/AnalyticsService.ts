import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type UsageEventDeduplicator } from "../../infrastructure/UsageEventDeduplicator";
import { CacheKeys } from "@shared/cache/keys";
import { type RedisClient } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class AnalyticsService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly mainClient: RedisClient,
    private readonly metrics: MetricsService,
    private readonly deduplicator?: UsageEventDeduplicator
  ) {}

  async handleUsageEvent(userId: string, count: number, eventId?: string): Promise<void> {
    const timer = this.metrics.jobDuration.startTimer({ job_type: "usage_event" });

    this.metrics.activeJobs.inc({ job_type: "usage_event" });
    let claimed = false;
    try {
      if (this.deduplicator && eventId) {
        const isNew = await this.deduplicator.tryBegin(eventId);
        if (!isNew) {
          Logger.info("Duplicate usage event skipped", { userId, eventId });
          try { this.metrics.staleEventsFilteredTotal.inc({ reason: "duplicate" }); } catch {}
          timer({ status: "duplicate" });
          return;
        }
        claimed = true;
      }

      await this.userRepository.incrementUsage(userId, count);

      try {
        const keys = [CacheKeys.user(userId)];
        // Also invalidate email key if we can resolve it (best-effort)
        try {
          const user = await this.userRepository.findUniqueById(userId);
          if (user?.email) keys.push(CacheKeys.userByEmail(user.email));
        } catch {}
        if (keys.length === 1) {
          await this.mainClient.del(keys[0]!);
        } else {
          // Use pipeline where possible for multi-key delete
          try {
            await this.mainClient.del(...keys);
          } catch {
            // Fallback per-key for cluster CROSSSLOT
            for (const k of keys) try { await this.mainClient.del(k); } catch {}
          }
        }
      } catch (error) {
        Logger.warn("Cache invalidation failed after usage flush", { userId, error });
      }

      this.metrics.jobTotal.inc({ job_type: "usage_event" });
      this.metrics.domainOperationsVolume.inc({ operation_type: "usage_flushed" }, count);

      timer({ status: "success" });
    } catch (error) {
      // Release dedup claim for retryable DB errors so redelivery can succeed
      if (claimed && eventId && this.deduplicator) {
        try { await this.deduplicator.release(eventId); } catch {}
      }
      try { this.metrics.jobErrors.inc({ job_type: "usage_event", error_type: "db_error" }); } catch {}
      timer({ status: "error" });
      throw error;
    } finally {
      this.metrics.activeJobs.dec({ job_type: "usage_event" });
    }
  }
}
