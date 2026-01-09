import { prisma } from "@shared/db";
import { redis } from "@shared/redis";
import { Logger } from "@shared/logger";
import { SubscriptionStatus } from "../../../../generated/prisma/client";
import { CacheKeys } from "@shared/cache/keys";

export class SubscriptionSweeper {
  private readonly BATCH_SIZE = 100;

  public async processExpiredSubscriptions(): Promise<number> {
    const now = new Date();

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
      return 0;
    }

    Logger.info(`Found ${expiredUsers.length} expired subscriptions to sweep.`);

    await this.bulkDowngradeUsers(expiredUsers);

    return expiredUsers.length;
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
      await redis.del(...keys);
    } catch (error) {
      Logger.error("Failed to bulk invalidate cache", error);
    }
  }
}