import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type UsageEventDeduplicator } from "../../infrastructure/UsageEventDeduplicator";
import { CacheKeys } from "@shared/cache/keys";
import { type RedisClient } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { UserCacheInvalidator } from "@shared/cache/invalidation";

export class AnalyticsService {
  private readonly cacheInvalidator: UserCacheInvalidator;
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly mainClient: RedisClient,
    private readonly metrics: MetricsService,
    private readonly deduplicator?: UsageEventDeduplicator
  ) {
    this.cacheInvalidator = new UserCacheInvalidator(mainClient, metrics);
  }

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
        let email: string | null = null;
        try {
          const user = await this.userRepository.findUniqueById(userId);
          if (user?.email) email = user.email;
        } catch {}
        if (email) {
          await this.cacheInvalidator.invalidateUser(userId, email);
        } else {
          await this.mainClient.del(CacheKeys.user(userId));
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
