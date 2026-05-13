import { expect, test, describe, beforeEach } from "bun:test";
import { prismaPrimary, prisma } from "../../../../shared/db";
import { RedisFactory } from "../../../../shared/redis";
import { LockService } from "../../../../shared/cache/lock";
import { MetricsService } from "../../../../shared/monitoring/MetricsService";
import { PrismaUserRepository } from "../../../../shared/repositories/UserRepository";
import { SubscriptionSweeper } from "../SubscriptionSweeper";
import { SubscriptionStatus } from "../../../../generated/prisma/client";

describe("SubscriptionSweeper Integration", () => {
    let sweeper: SubscriptionSweeper;
    let redis: any;
    let lockService: LockService;
    let userRepository: PrismaUserRepository;

    beforeEach(async () => {
        redis = RedisFactory.createClient({
            mode: "standalone",
            name: "test-redis",
            url: process.env.REDIS_URL,
        });
        lockService = new LockService(redis);
        const metrics = new MetricsService("test-cron");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
        sweeper = new SubscriptionSweeper(userRepository, redis, lockService, metrics);
    });

    test("should sweep expired subscriptions", async () => {
        // 1. Create users with different subscription states
        const now = new Date();
        const expiredDate = new Date(now.getTime() - 10000);
        const futureDate = new Date(now.getTime() + 86400000);

        const userExpired = await prismaPrimary.user.create({
            data: {
                email: "expired@example.com",
                name: "Expired User",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        endsAt: expiredDate,
                        paddleSubscriptionId: "sub_expired",
                        paddlePlanId: "plan_1",
                    }
                }
            }
        });

        const userActive = await prismaPrimary.user.create({
            data: {
                email: "active@example.com",
                name: "Active User",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        endsAt: futureDate,
                        paddleSubscriptionId: "sub_active",
                        paddlePlanId: "plan_1",
                    }
                }
            }
        });

        // 2. Process expired subscriptions
        const swept = await sweeper.processExpiredSubscriptions();
        expect(swept).toBe(1);

        // 3. Verify userExpired is CANCELED
        const updatedExpired = await prismaPrimary.subscription.findUnique({
            where: { userId: userExpired.id }
        });
        expect(updatedExpired?.status).toBe(SubscriptionStatus.CANCELED);

        // 4. Verify userActive is still ACTIVE
        const updatedActive = await prismaPrimary.subscription.findUnique({
            where: { userId: userActive.id }
        });
        expect(updatedActive?.status).toBe(SubscriptionStatus.ACTIVE);
    });

    test("should respect distributed lock", async () => {
        // Mock a lock already being held
        await redis.set("lock:cron:subscription_sweeper", "someone-else", "PX", 10000);

        const swept = await sweeper.processExpiredSubscriptions();
        expect(swept).toBe(0); // Should skip because lock is held
    });
});
