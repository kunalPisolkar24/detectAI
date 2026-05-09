import { type IUserRepository } from "@shared/repositories/UserRepository";
import { type RedisClient } from "@shared/redis";
import { LockService } from "@shared/cache/lock";
import { Logger } from "@shared/logger";
import { SubscriptionStatus } from "../../../../generated/prisma/client";
import { CacheKeys } from "@shared/cache/keys";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class SubscriptionSweeper {
    private readonly BATCH_SIZE = 100;
    private readonly LOCK_KEY = "cron:subscription_sweeper";
    private readonly LOCK_TTL_MS = 120_000;

    constructor(
        private readonly userRepository: IUserRepository,
        private readonly redis: RedisClient,
        private readonly lockService: LockService,
        private readonly metrics: MetricsService
    ) {}

    public async processExpiredSubscriptions(): Promise<number> {
        const release = await this.lockService.acquire(this.LOCK_KEY, this.LOCK_TTL_MS);

        if (!release) {
            Logger.warn("Subscription sweeper lock already held by another instance, skipping.");
            return 0;
        }

        const timer = this.metrics.jobDuration.startTimer({ job_type: "sweep_expired" });

        try {
            const now = new Date();
            const expiredUsers = await this.userRepository.findExpiredSubscriptions(now, this.BATCH_SIZE);

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
            await release();
        }
    }

    private async bulkDowngradeUsers(users: { id: string; email: string }[]): Promise<void> {
        const userIds = users.map(u => u.id);

        await this.userRepository.bulkUpdateStatus(userIds, {
            paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
            paddleCancellationScheduled: false,
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