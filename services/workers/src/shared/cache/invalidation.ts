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
            await this.redis.del(...keys);
            this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
        } catch (error) {
            Logger.error("Failed to invalidate user cache", error);
            this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "redis_error" });
        }
    }
}
