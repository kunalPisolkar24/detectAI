import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { CacheKeys } from "@shared/cache/keys";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { SubscriptionUpdatedHandler } from "../SubscriptionUpdatedHandler";
import { SubscriptionStatus } from "../../../../../../generated/prisma/client";

describe("SubscriptionUpdatedHandler Integration", () => {
    let handler: SubscriptionUpdatedHandler;
    let redis: any;
    let eventRedis: any;
    let userRepository: PrismaUserRepository;

    beforeEach(async () => {
        const redisUrl = process.env.REDIS_URL!;
        redis = RedisFactory.createClient({
            mode: "standalone",
            name: "test-redis",
            url: redisUrl,
        });
        eventRedis = RedisFactory.createClient({
            mode: "standalone",
            name: "test-event-redis",
            url: redisUrl,
        });
        const metrics = new MetricsService("test-payments");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
        handler = new SubscriptionUpdatedHandler(userRepository, redis, eventRedis, metrics);
    });

    afterEach(async () => {
        await redis.quit().catch(() => {});
        await eventRedis.quit().catch(() => {});
    });

    test("should handle subscription update and invalidate cache", async () => {
        // 1. Seed user
        const user = await prismaPrimary.user.create({
            data: {
                email: "sub-update@example.com",
                name: "Sub Update User",
            },
        });

        // 2. Set some initial cache
        await redis.set(CacheKeys.user(user.id), "initial-cache");

        // 3. Prepare Paddle event
        const eventData = {
            id: "sub_123",
            status: "active",
            customer_id: "ctm_123",
            items: [
                {
                    price: { id: "pri_123" }
                }
            ],
            current_billing_period: {
                ends_at: new Date(Date.now() + 86400000).toISOString()
            },
            occurred_at: new Date().toISOString(),
        };

        // 4. Handle event
        await handler.handle(user.id, eventData as any);

        // 5. Verify DB update
        const updatedUser = await prismaPrimary.user.findUnique({
            where: { id: user.id },
            include: { subscription: true }
        });
        expect(updatedUser?.subscription?.status).toBe(SubscriptionStatus.ACTIVE);
        expect(updatedUser?.subscription?.paddleSubscriptionId).toBe("sub_123");

        // 6. Verify cache invalidation
        const cachedUser = await redis.get(CacheKeys.user(user.id));
        expect(cachedUser).toBeNull();
    });
});
