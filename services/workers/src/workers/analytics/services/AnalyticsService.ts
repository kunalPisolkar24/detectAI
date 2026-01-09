import { prisma } from "@shared/db";
import { createRedisClient } from "@shared/redis";
import { Logger } from "@shared/logger";
import { config } from "../config";
import { baseEnvSchema } from "@shared/config";
import { CacheKeys, TTL } from "@shared/cache/keys";
import { JsonSerializer } from "@shared/cache/serialization";

const mainConfig = baseEnvSchema.parse(process.env);

interface UsageUpdate {
  userId: string;
  count: number;
}

interface UserCacheData {
  apiCallCountTotal: number;
  apiCallCountDaily: number;
  [key: string]: any;
}

export class AnalyticsService {
  private usageRedis;
  private mainRedis;
  private readonly BATCH_SIZE = 50;
  private readonly DIRTY_SET_KEY = "usage:dirty_users";
  private readonly PENDING_KEY_PREFIX = "usage:pending:";

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
      for (const { userId, count } of updates) {
        const key = CacheKeys.user(userId);

        await this.mainRedis.watch(key);

        const rawData = await this.mainRedis.get(key);

        if (!rawData) {
          await this.mainRedis.unwatch();
          continue;
        }

        try {
          const userObj = JsonSerializer.deserialize<UserCacheData>(rawData);

          if (typeof userObj.apiCallCountTotal === 'number') {
            userObj.apiCallCountTotal += count;

            if (typeof userObj.apiCallCountDaily === 'number') {
              userObj.apiCallCountDaily += count;
            }

            const newRawData = JsonSerializer.serialize(userObj);

            const multi = this.mainRedis.multi();
            multi.setex(key, TTL.USER, newRawData);
            const result = await multi.exec();

            if (!result) {
              Logger.warn(`Optimistic lock failed for user ${userId}`);
            }
          } else {
            await this.mainRedis.unwatch();
          }
        } catch (e) {
          await this.mainRedis.unwatch();
          Logger.warn(`Failed to patch cache for ${userId}`, { error: e });
        }
      }
    } catch (error) {
      Logger.warn("Global error in patchUserCache", { error });
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