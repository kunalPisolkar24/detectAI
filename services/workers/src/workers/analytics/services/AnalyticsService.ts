import { prisma } from "@shared/db";
import { createRedisClient } from "@shared/redis";
import { Logger } from "@shared/logger";
import { config } from "../config";
import { baseEnvSchema } from "@shared/config";

const mainConfig = baseEnvSchema.parse(process.env);

interface UsageUpdate {
  userId: string;
  count: number;
}

export class AnalyticsService {
  private usageRedis;
  private mainRedis;
  private readonly BATCH_SIZE = 50;
  private readonly DIRTY_SET_KEY = "usage:dirty_users";
  private readonly PENDING_KEY_PREFIX = "usage:pending:";
  private readonly CACHE_TTL = 3600;

  constructor() {
    this.usageRedis = createRedisClient(config.REDIS_USAGE_URL, "UsageRedis");
    this.mainRedis = createRedisClient(mainConfig.REDIS_URL, "MainRedis");
  }

  public async processBatch(): Promise<number> {
    const userIds = await this.usageRedis.spop(this.DIRTY_SET_KEY, this.BATCH_SIZE);

    if (!userIds || userIds.length === 0) {
      return 0;
    }

    const updates: UsageUpdate[] = [];
    const pipeline = this.usageRedis.pipeline();

    for (const userId of userIds) {
      pipeline.get(`${this.PENDING_KEY_PREFIX}${userId}`);
    }

    const results = await pipeline.exec();

    if (!results) return 0;

    results.forEach((result, index) => {
      const [err, countVal] = result;
      const userId = userIds[index];
      const count = countVal ? parseInt(countVal as string, 10) : 0;

      if (!err && count > 0 && userId) {
        updates.push({ userId, count });
      }
    });

    if (updates.length === 0) return 0;

    const success = await this.flushToDatabase(updates);

    if (success) {
      await this.decrementAndRequeue(updates);
      await this.patchUserCaches(updates);
    } else {
      await this.requeueFailedUsers(userIds);
    }

    return updates.length;
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

  private async patchUserCaches(updates: UsageUpdate[]) {
    try {
      const pipeline = this.mainRedis.pipeline();

      updates.forEach(({ userId }) => {
        pipeline.get(`user:${userId}`);
        pipeline.get(`user:id:${userId}`);
      });

      const results = await pipeline.exec();
      if (!results) return;

      const writePipeline = this.mainRedis.pipeline();

      for (let i = 0; i < updates.length; i++) {
        const update = updates[i];
        if (!update) continue;

        const { userId, count } = update;

        const sessionCacheRes = results[i * 2];
        const dataCacheRes = results[(i * 2) + 1];

        if (sessionCacheRes) {
          this.updateCacheEntry(writePipeline, `user:${userId}`, sessionCacheRes, count);
        }
        if (dataCacheRes) {
          this.updateCacheEntry(writePipeline, `user:id:${userId}`, dataCacheRes, count);
        }
      }

      await writePipeline.exec();
    } catch (error) {
      Logger.warn("Failed to patch user cache", { error });
    }
  }

  private updateCacheEntry(pipeline: any, key: string, result: [error: Error | null, result: unknown], countToAdd: number) {
    const [err, data] = result;
    if (!err && data && typeof data === 'string') {
      try {
        const userObj = JSON.parse(data);

        if (typeof userObj.apiCallCountTotal === 'number') {
          userObj.apiCallCountTotal += countToAdd;

          if (typeof userObj.apiCallCountDaily === 'number') {
            userObj.apiCallCountDaily += countToAdd;
          }

          pipeline.set(key, JSON.stringify(userObj), 'EX', this.CACHE_TTL);
        }
      } catch (e) {
        Logger.warn(`Failed to parse cache entry for key ${key}`, { error: e });
      }
    }
  }

  private async decrementAndRequeue(updates: UsageUpdate[]) {
    const pipeline = this.usageRedis.pipeline();

    for (const { userId, count } of updates) {
      const key = `${this.PENDING_KEY_PREFIX}${userId}`;
      pipeline.decrby(key, count);
    }

    const results = await pipeline.exec();

    const usersStillDirty: string[] = [];

    results?.forEach((result, index) => {
      const [err, remaining] = result;
      const update = updates[index];

      if (!err && (remaining as number) > 0 && update) {
        usersStillDirty.push(update.userId);
      }
    });

    if (usersStillDirty.length > 0) {
      await this.usageRedis.sadd(this.DIRTY_SET_KEY, ...usersStillDirty);
      Logger.info(`Re-queued ${usersStillDirty.length} active users`);
    }
  }

  private async requeueFailedUsers(userIds: string[]) {
    if (userIds.length === 0) return;
    try {
      await this.usageRedis.sadd(this.DIRTY_SET_KEY, ...userIds);
    } catch (error) {
      Logger.error("CRITICAL: Failed to requeue users after DB error", error);
    }
  }

  public async shutdown() {
    await this.usageRedis.quit();
    await this.mainRedis.quit();
  }
}