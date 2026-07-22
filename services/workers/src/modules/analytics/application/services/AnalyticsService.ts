import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { CacheKeys } from "@shared/cache/keys";
import { type RedisClient } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class AnalyticsService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly mainClient: RedisClient,
    private readonly metrics: MetricsService
  ) {}

  async handleUsageEvent(userId: string, count: number): Promise<void> {
    const timer = this.metrics.jobDuration.startTimer({ job_type: "usage_event" });

    this.metrics.activeJobs.inc({ job_type: "usage_event" });
    try {
      await this.userRepository.incrementUsage(userId, count);
      await this.mainClient.del(CacheKeys.user(userId));

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
