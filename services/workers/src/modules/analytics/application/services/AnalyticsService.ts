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
    try {
      if (this.deduplicator && eventId) {
        const isNew = await this.deduplicator.tryBegin(eventId);
        if (!isNew) {
          Logger.info("Duplicate usage event skipped", { userId, eventId });
          timer({ status: "duplicate" });
          return;
        }
      }

      await this.userRepository.incrementUsage(userId, count);

      try {
        await this.mainClient.del(CacheKeys.user(userId));
      } catch (error) {
        Logger.warn("Cache invalidation failed after usage flush", { userId, error });
      }

      this.metrics.jobTotal.inc({ job_type: "usage_event" });
      this.metrics.domainOperationsVolume.inc({ operation_type: "usage_flushed" }, count);

      timer({ status: "success" });
    } catch (error) {
      this.metrics.jobErrors.inc({ job_type: "usage_event", error_type: "db_error" });
      timer({ status: "error" });
      throw error;
    } finally {
      this.metrics.activeJobs.dec({ job_type: "usage_event" });
    }
  }
}
