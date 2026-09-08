import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type UsageEventDeduplicator } from "../../infrastructure/UsageEventDeduplicator";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class AnalyticsService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly metrics: MetricsService,
    private readonly deduplicator?: UsageEventDeduplicator
  ) {}

  /**
   * Persist one usage event exactly once per `eventId`.
   *
   * `eventId` is required: without it redeliveries cannot dedupe. The queue
   * schema enforces this; this guard is defense-in-depth for direct callers.
   *
   * No cache invalidation: cached rows (`user:basic:*`, `user:sub:*`) exclude
   * usage counters, and `rate_limit:*` counters expire at midnight UTC.
   * Usage tracking (async here, sync fallback in web `trackUsage`) never
   * touches user cache — this removes the pre-split churn where every
   * increment evicted the whole user blob.
   */
  async handleUsageEvent(userId: string, count: number, eventId: string): Promise<void> {
    const timer = this.metrics.jobDuration.startTimer({ job_type: "usage_event" });

    this.metrics.activeJobs.inc({ job_type: "usage_event" });
    let claimed = false;
    try {
      if (!eventId || typeof eventId !== "string" || !eventId.trim()) {
        throw new Error("handleUsageEvent requires a non-empty eventId");
      }
      if (this.deduplicator) {
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
