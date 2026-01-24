import { prisma } from "@shared/db";
import { type RedisClient } from "@shared/redis";
import { Logger } from "@shared/logger";
import { SubscriptionStatus } from "../../../../generated/prisma/client";
import { CacheKeys } from "@shared/cache/keys";
import { MetricsService } from "@shared/monitoring/MetricsService";

export class SubscriptionSweeper {
  private readonly BATCH_SIZE = 100;

  constructor(
    private readonly redis: RedisClient,
    private readonly metrics: MetricsService
  ) {}

  public async processExpiredSubscriptions(): Promise<number> {
    const timer = this.metrics.jobDuration.startTimer({ job_type: "sweep_expired" });
    const now = new Date();

    try {
      const expiredUsers = await prisma.user.findMany({
        where: {
          OR: [
            { paddleSubscriptionStatus: SubscriptionStatus.ACTIVE },
            { paddleSubscriptionStatus: SubscriptionStatus.TRIALING }
          ],
          subscriptionEndsAt: {
            lt: now,
          },
        },
        take: this.BATCH_SIZE,
        select: {
          id: true,
          email: true,
        },
      });

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
    }
  }

  private async bulkDowngradeUsers(users: { id: string; email: string }[]) {
    if (users.length === 0) return;

    const userIds = users.map(u => u.id);

    try {
      await prisma.user.updateMany({
        where: {
          id: { in: userIds }
        },
        data: {
          paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
          paddleCancellationScheduled: false,
          paddleSubscriptionId: null,
          paddlePlanId: null,
        },
      });

      await this.bulkInvalidateCache(users);
      
      Logger.info(`Successfully swept batch of ${users.length} users`);
    } catch (error) {
      Logger.error("Failed to perform bulk sweep", error);
      throw error;
    }
  }

  private async bulkInvalidateCache(users: { id: string; email: string }[]): Promise<void> {
    const keys: string[] = [];

    for (const user of users) {
      keys.push(CacheKeys.user(user.id));
      keys.push(CacheKeys.userByEmail(user.email));
    }

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