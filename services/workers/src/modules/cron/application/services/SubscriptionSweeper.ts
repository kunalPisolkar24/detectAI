import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { UserCacheInvalidator } from "@shared/cache/invalidation";
import { type RedisClient } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class SubscriptionSweeper {
    private readonly BATCH_SIZE: number;

    private readonly cacheInvalidator: UserCacheInvalidator;

    constructor(
        private readonly userRepository: IUserRepository,
        redis: RedisClient,
        private readonly metrics: MetricsService,
        batchSize = 100
    ) {
        this.BATCH_SIZE = batchSize;
        this.cacheInvalidator = new UserCacheInvalidator(redis, metrics);
    }

    public async processExpiredSubscriptions(): Promise<number> {
        const timer = this.metrics.jobDuration.startTimer({ job_type: "sweep_expired" });

        this.metrics.activeJobs.inc({ job_type: "sweep_expired" });
        try {
            const sweepTime = new Date();

            // Expiry is a terminal downgrade; it intentionally bypasses the
            // payments stateMachine (PAUSED->CANCELED is invalid via webhooks
            // but is the whole point of the sweep, see #196/#178).
            // cancellationScheduled:false is intentional: once endsAt has passed,
            // a scheduled cancellation is moot — the row is fully canceled.
            const sweptUsers = await this.userRepository.expireDueSubscriptions(this.BATCH_SIZE, {
                status: SubscriptionStatus.CANCELED,
                cancellationScheduled: false,
                paddleSubscriptionId: null,
                paddlePlanId: null,
                eventTimestamp: sweepTime,
            }, sweepTime, async (selected) => {
                // Pre-commit DEL (payments-style double-del): shrinks the window
                // where a replica-lag read repopulates stale entries after commit.
                // ~100ms replica lag remains possible; see #187.
                await this.cacheInvalidator.invalidateUsers(selected);
            });

            if (sweptUsers.length === 0) {
                timer({ status: "empty" });
                return 0;
            }

            Logger.info(`Found ${sweptUsers.length} expired subscriptions to sweep.`);

            for (const user of sweptUsers) {
                if (user.paddleSubscriptionId) {
                    Logger.info("Sweep clearing paddle identifiers for downgraded subscription", {
                        userId: user.id,
                        paddleSubscriptionId: user.paddleSubscriptionId,
                    });
                }
            }

            await this.cacheInvalidator.invalidateUsers(sweptUsers);

            this.metrics.jobTotal.inc({ job_type: "user_downgrade" }, sweptUsers.length);
            timer({ status: "success" });
            return sweptUsers.length;
        } catch (error) {
            timer({ status: "error" });
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: "sweep_expired" });
        }
    }

}