import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { CacheKeys } from "@shared/cache/keys";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class SubscriptionSweeper {
    private readonly BATCH_SIZE = 100;

    constructor(
        private readonly userRepository: IUserRepository,
        private readonly redis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    public async processExpiredSubscriptions(): Promise<number> {
        const timer = this.metrics.jobDuration.startTimer({ job_type: "sweep_expired" });

        this.metrics.activeJobs.inc({ job_type: "sweep_expired" });
        try {
            const expiredUsers = await this.userRepository.findExpiredSubscriptionsWithLock(this.BATCH_SIZE);

            if (expiredUsers.length === 0) {
                timer({ status: "empty" });
                return 0;
            }

            Logger.info(`Found ${expiredUsers.length} expired subscriptions to sweep.`);

            await this.bulkDowngradeUsers(expiredUsers);

            this.metrics.jobTotal.inc({ job_type: "user_downgrade" }, expiredUsers.length);
            timer({ status: "success" });
            return expiredUsers.length;
        } catch (error) {
            timer({ status: "error" });
            this.metrics.jobErrors.inc({ job_type: "sweep_expired", error_type: "db_error" });
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: "sweep_expired" });
        }
    }

    private async bulkDowngradeUsers(users: { id: string; email: string }[]): Promise<void> {
        const userIds = users.map(u => u.id);

        // Pre-invalidate before DB write to shrink the stale-read window.
        // If the write fails, the next read pays a cache-miss penalty — acceptable for consistency.
        await this.bulkInvalidateCache(users);

        await this.userRepository.bulkUpdateStatus(userIds, {
            status: SubscriptionStatus.CANCELED,
            cancellationScheduled: false,
            paddleSubscriptionId: null,
            paddlePlanId: null,
        });

        await this.bulkInvalidateCache(users);

        Logger.info(`Successfully swept batch of ${users.length} users`);
    }

    private async bulkInvalidateCache(users: { id: string; email: string }[]): Promise<void> {
        const keys: string[] = users.flatMap(user => [
            CacheKeys.user(user.id),
            CacheKeys.userByEmail(user.email),
        ]);

        if (keys.length === 0) return;

        try {
            await this.redis.del(...keys);
            this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
        } catch (error) {
            Logger.error("Failed to bulk invalidate cache", error);
            this.metrics.jobErrors.inc({ job_type: "bulk_invalidate", error_type: "redis_error" });
        }
    }
}