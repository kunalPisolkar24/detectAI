import { Cluster, Redis } from "ioredis";
import { prisma } from "@shared/db";
import { createRedisClient, createClusterClient } from "@shared/redis";
import { Logger } from "@shared/logger";
import { config } from "../config";
import { baseEnvSchema } from "@shared/config";
import { CacheKeys } from "@shared/cache/keys";

const mainConfig = baseEnvSchema.parse(process.env);

interface UsageUpdate {
    userId: string;
    count: number;
}

export class AnalyticsService {
    private usageCluster: Cluster;
    private mainRedis: Redis;
    private readonly BATCH_SIZE = 50;
    private readonly DIRTY_SET_KEY = "usage:dirty_users";
    private readonly PENDING_KEY_PREFIX = "usage:pending:";

    constructor() {
        this.usageCluster = createClusterClient(config.REDIS_USAGE_URL, "UsageCluster");
        this.mainRedis = createRedisClient(mainConfig.REDIS_URL, "MainRedis");
    }

    public async processBatch(): Promise<number> {
        const userIds = await this.usageCluster.spop(this.DIRTY_SET_KEY, this.BATCH_SIZE);

        if (!userIds || userIds.length === 0) {
            return 0;
        }

        const updates = await this.fetchPendingCounts(userIds);

        if (updates.length === 0) {
            return 0;
        }

        const success = await this.flushToDatabase(updates);

        if (success) {
            await this.finalizeUpdates(updates);
        } else {
            await this.requeueFailedUsers(userIds);
        }

        return updates.length;
    }

    private async fetchPendingCounts(userIds: string[]): Promise<UsageUpdate[]> {
        const updates: UsageUpdate[] = [];

        try {
            const promises = userIds.map(id => 
                this.usageCluster.get(`${this.PENDING_KEY_PREFIX}${id}`)
            );
            
            const results = await Promise.all(promises);

            results.forEach((countStr, index) => {
                const count = countStr ? parseInt(countStr, 10) : 0;
                const userId = userIds[index];
                
                if (count > 0 && userId) {
                    updates.push({
                        userId,
                        count
                    });
                }
            });
        } catch (error) {
            Logger.error("Failed to fetch pending counts from cluster", error);
            await this.requeueFailedUsers(userIds);
            return [];
        }

        return updates;
    }

    private async flushToDatabase(updates: UsageUpdate[]): Promise<boolean> {
        try {
            await prisma.$transaction(
                updates.map(({ userId, count }) =>
                    prisma.user.update({
                        where: { id: userId },
                        data: {
                            apiCallCountTotal: { increment: count },
                            apiCallCountDaily: { increment: count },
                            lastApiCallReset: new Date()
                        }
                    })
                )
            );

            Logger.info(`Successfully flushed usage for ${updates.length} users`);
            return true;
        } catch (error) {
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
        }
    }

    private async decrementPendingCounts(updates: UsageUpdate[]): Promise<void> {
        const promises = updates.map(({ userId, count }) => 
            this.usageCluster.decrby(`${this.PENDING_KEY_PREFIX}${userId}`, count)
        );

        await Promise.all(promises);

        const stillDirtyUsers: string[] = [];
        const checkPromises = updates.map(({ userId }) => 
            this.usageCluster.get(`${this.PENDING_KEY_PREFIX}${userId}`)
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
            await this.usageCluster.sadd(this.DIRTY_SET_KEY, ...stillDirtyUsers);
        }
    }

    private async bulkInvalidateCache(updates: UsageUpdate[]): Promise<void> {
        if (updates.length === 0) return;

        const keys = updates.flatMap(({ userId }) => [
            CacheKeys.user(userId)
        ]);

        try {
            await this.mainRedis.del(...keys);
        } catch (error) {
            Logger.error("Failed to invalidate cache keys", error);
        }
    }

    private async requeueFailedUsers(userIds: string[]): Promise<void> {
        if (userIds.length === 0) return;
        try {
            await this.usageCluster.sadd(this.DIRTY_SET_KEY, ...userIds);
            Logger.warn(`Requeued ${userIds.length} users after processing failure`);
        } catch (error) {
            Logger.error("CRITICAL: Failed to requeue users", error);
        }
    }

    public async shutdown(): Promise<void> {
        try {
            await this.usageCluster.quit();
            await this.mainRedis.quit();
        } catch (error) {
            Logger.error("Error during service shutdown", error);
        }
    }
}