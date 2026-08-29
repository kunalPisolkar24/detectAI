import { CacheKeys } from "./keys";
import { type RedisClient } from "./RedisClient";
import { Logger } from "../logging/Logger";
import { type MetricsService } from "../monitoring/MetricsService";

export class UserCacheInvalidator {
    constructor(
        private readonly redis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    async invalidateUser(userId: string, email: string): Promise<void> {
        await this.invalidateUsers([{ id: userId, email }]);
    }

    async invalidateUsers(users: ReadonlyArray<{ id: string; email: string }>): Promise<void> {
        const keys = users.flatMap(user => [CacheKeys.user(user.id), CacheKeys.userByEmail(user.email)]);
        if (keys.length === 0) return;

        try {
            let durationTimer = this.metrics.cacheInvalidateDurationSeconds.startTimer({ attempt: "1" });
            try {
                await this.redis.del(...keys);
                durationTimer();
            } catch (firstError) {
                durationTimer();
                // One immediate retry: transient blips are common, and a missed DEL
                // leaves stale entitlements cached until TTL.
                try {
                    this.metrics.cacheInvalidateRetriesTotal.inc();
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 50));
                durationTimer = this.metrics.cacheInvalidateDurationSeconds.startTimer({ attempt: "2" });
                try {
                    await this.redis.del(...keys);
                    durationTimer();
                } catch (retryError) {
                    durationTimer();
                    throw retryError;
                }
            }
            this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
        } catch (error) {
            // Fail-open by design: the DB write has already committed, so failing
            // the caller here would not un-commit it. The stale entry self-heals
            // at TTL; divergence is observable via cache_invalidate jobErrors.
            Logger.error("Failed to invalidate user cache after retry", error);
            this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "redis_error" });
        }
    }
}
