import { prisma } from "@shared/db";
import { Logger } from "@shared/logger";
import { CacheKeys } from "@shared/cache/keys";
import { type RedisClient } from "@shared/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";

interface UsageUpdate {
    userId: string;
    count: number;
}

export class AnalyticsService {
    private readonly BATCH_SIZE = 50;
    private readonly DIRTY_SET_KEY = "usage:dirty_users";
    private readonly PENDING_KEY_PREFIX = "usage:pending:";

    constructor(
        private readonly usageClient: RedisClient,
        private readonly mainClient: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    public async processBatch(): Promise<number> {
        const timer = this.metrics.jobDuration.startTimer({ job_type: "process_batch" });

        try {
            const userIds = await this.usageClient.spop(this.DIRTY_SET_KEY, this.BATCH_SIZE);

            if (!userIds || userIds.length === 0) {
                timer({ status: "empty" });
                return 0;
            }

            const updates = await this.fetchPendingCounts(userIds);

            if (updates.length === 0) {
                timer({ status: "no_updates" });
                return 0;
            }

            const success = await this.flushToDatabase(updates);

            if (success) {
                await this.finalizeUpdates(updates);
                this.metrics.jobTotal.inc({ job_type: "usage_flush" }, updates.length);
            } else {
                await this.requeueFailedUsers(userIds);
                this.metrics.jobErrors.inc({ job_type: "usage_flush", error_type: "db_error" });
            }

            timer({ status: "success" });
            return updates.length;
        } catch (error) {
            timer({ status: "error" });
            throw error;
        }
    }

    private async fetchPendingCounts(userIds: string[]): Promise<UsageUpdate[]> {
        const updates: UsageUpdate[] = [];

        try {
            const promises = userIds.map(id => 
                this.usageClient.get(`${this.PENDING_KEY_PREFIX}${id}`)
            );
            
            const results = await Promise.all(promises);

            results.forEach((countStr, index) => {
                const count = countStr ? parseInt(countStr, 10) : 0;
                const userId = userIds[index];
                
                if (count > 0 && userId) {
                    updates.push({ userId, count });
                    this.metrics.cacheOperations.inc({ operation: "hit", cache_type: "usage_cluster" });
                } else {
                    this.metrics.cacheOperations.inc({ operation: "miss", cache_type: "usage_cluster" });
                }
            });
        } catch (error) {
            Logger.error("Failed to fetch pending counts from cluster", error);
            await this.requeueFailedUsers(userIds);
            this.metrics.jobErrors.inc({ job_type: "fetch_counts", error_type: "redis_error" });
            return [];
        }

        return updates;
    }

    private async flushToDatabase(updates: UsageUpdate[]): Promise<boolean> {
        const dbTimer = this.metrics.jobDuration.startTimer({ job_type: "db_flush" });
        try {
            const values = updates
                .map(({ userId, count }) => `('${userId}', ${count}, NOW())`)
                .join(",");

            if (!values) {
                dbTimer({ status: "empty" });
                return true;
            }

            await prisma.$executeRawUnsafe(`
                UPDATE "User" as u
                SET 
                    "apiCallCountTotal" = u."apiCallCountTotal" + v.count,
                    "apiCallCountDaily" = u."apiCallCountDaily" + v.count,
                    "lastApiCallReset" = v.reset_time
                FROM (VALUES ${values}) as v(user_id, count, reset_time)
                WHERE u.id = v.user_id
            `);

            dbTimer({ status: "success" });
            Logger.info(`Successfully flushed usage for ${updates.length} users`);
            return true;
        } catch (error) {
            dbTimer({ status: "error" });
            Logger.error("Failed to flush usage stats to database", error);
            return false;
        }
    }

    private async finalizeUpdates(updates: UsageUpdate[]): Promise<void> {
        try {
            await this.decrementPendingCounts(updates);
            await this.bulkInvalidateCache(updates);
        } catch (error) {
            Logger.error("Error during finalization phase", error);
            this.metrics.jobErrors.inc({ job_type: "finalize", error_type: "partial_failure" });
        }
    }

    private async decrementPendingCounts(updates: UsageUpdate[]): Promise<void> {
        const promises = updates.map(({ userId, count }) => 
            this.usageClient.decrby(`${this.PENDING_KEY_PREFIX}${userId}`, count)
        );

        await Promise.all(promises);

        const stillDirtyUsers: string[] = [];
        const checkPromises = updates.map(({ userId }) => 
            this.usageClient.get(`${this.PENDING_KEY_PREFIX}${userId}`)
        );

        const results = await Promise.all(checkPromises);

        results.forEach((val, index) => {
            const remaining = val ? parseInt(val, 10) : 0;
            const update = updates[index];

            if (remaining > 0 && update) {
                stillDirtyUsers.push(update.userId);
            }
        });

        if (stillDirtyUsers.length > 0) {
            await this.usageClient.sadd(this.DIRTY_SET_KEY, ...stillDirtyUsers);
        }
    }

    private async bulkInvalidateCache(updates: UsageUpdate[]): Promise<void> {
        if (updates.length === 0) return;

        const keys = updates.flatMap(({ userId }) => [
            CacheKeys.user(userId)
        ]);

        try {
            await this.mainClient.del(...keys);
            this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main_cache" }, keys.length);
        } catch (error) {
            Logger.error("Failed to invalidate cache keys", error);
            this.metrics.jobErrors.inc({ job_type: "cache_invalidation", error_type: "redis_error" });
        }
    }

    private async requeueFailedUsers(userIds: string[]): Promise<void> {
        if (userIds.length === 0) return;
        try {
            await this.usageClient.sadd(this.DIRTY_SET_KEY, ...userIds);
            Logger.warn(`Requeued ${userIds.length} users after processing failure`);
        } catch (error) {
            Logger.error("CRITICAL: Failed to requeue users", error);
        }
    }
    
    public async shutdown(): Promise<void> {
    }
}