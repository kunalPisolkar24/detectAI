import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { CacheKeys } from "@shared/cache/keys";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
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
                    name: "test-redis",
            url: redisUrl,
        });
        eventRedis = RedisFactory.createClient({
                    name: "test-event-redis",
            url: redisUrl,
        });
        // Wait for redis clients to be ready before issuing commands
        await Promise.all([
            new Promise<void>((resolve, reject) => {
                const t = setTimeout(() => reject(new Error("redis ready timeout")), 5000);
                redis.once("ready", () => { clearTimeout(t); resolve(); });
                redis.once("error", (e: Error) => { clearTimeout(t); reject(e); });
                if (redis.status === "ready") { clearTimeout(t); resolve(); }
            }).catch(() => {}),
            new Promise<void>((resolve, reject) => {
                const t = setTimeout(() => reject(new Error("event redis ready timeout")), 5000);
                eventRedis.once("ready", () => { clearTimeout(t); resolve(); });
                eventRedis.once("error", (e: Error) => { clearTimeout(t); reject(e); });
                if (eventRedis.status === "ready") { clearTimeout(t); resolve(); }
            }).catch(() => {}),
        ]);
        // Small grace to ensure connection is writable
        await new Promise((r) => setTimeout(r, 200));
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

        // 2. Set some initial cache (split layout: basic + sub)
        await redis.set(CacheKeys.userBasic(user.id), "initial-cache");
        await redis.set(CacheKeys.userSub(user.id), "initial-sub");

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

        // 6. Verify cache invalidation (basic + sub + legacy)
        expect(await redis.get(CacheKeys.userBasic(user.id))).toBeNull();
        expect(await redis.get(CacheKeys.userSub(user.id))).toBeNull();
    });
});
