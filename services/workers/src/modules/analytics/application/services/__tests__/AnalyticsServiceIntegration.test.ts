import { expect, test, describe, beforeEach } from "bun:test";
import { CacheKeys } from "@shared/cache/keys";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { AnalyticsService } from "../AnalyticsService";

describe("AnalyticsService Integration", () => {
    let service: AnalyticsService;
    let redis: any;
    let userRepository: PrismaUserRepository;

    beforeEach(async () => {
        redis = RedisFactory.createClient({
            mode: "standalone",
            name: "test-redis",
            url: process.env.REDIS_URL,
        });
        const metrics = new MetricsService("test-analytics");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
        // Using same redis for both usage and main client in tests
        service = new AnalyticsService(userRepository, redis, redis, metrics);
    });

    test("should process usage batch correctly", async () => {
        // 1. Seed user in DB
        const user = await prismaPrimary.user.create({
            data: {
                email: "analytics-test@example.com",
                name: "Analytics User",
            },
        });

        // 2. Seed usage in Redis
        const userId = user.id;
        await redis.sadd("usage:dirty_users", userId);
        await redis.set(`usage:{${userId}}:pending`, "10");
        await redis.set(CacheKeys.user(userId), "cached-data");

        // 3. Process batch
        const processed = await service.processBatch();
        expect(processed).toBe(1);

        // 4. Verify DB update
        const usage = await prismaPrimary.usage.findUnique({
            where: { userId },
        });
        expect(usage?.apiCallCountTotal).toBe(10);

        // 5. Verify Redis state
        const pending = await redis.get(`usage:{${userId}}:pending`);
        expect(Number(pending)).toBe(0);
        
        const dirty = await redis.sismember("usage:dirty_users", userId);
        expect(dirty).toBe(0);

        // 6. Verify cache invalidation
        const cached = await redis.get(CacheKeys.user(userId));
        expect(cached).toBeNull();
    });

    test("should requeue users on DB failure", async () => {
        const userId = "non-existent-user-id";
        await redis.sadd("usage:dirty_users", userId);
        await redis.set(`usage:{${userId}}:pending`, "5");

        // processBatch will fail to update DB because user doesn't exist (Prisma error)
        // or actually, it might just throw if the user is missing and we use update.
        // PrismaUserRepository.incrementUsage uses executeRaw which might not throw if user missing unless there's a constraint.
        // Let's check incrementUsage in UserRepository.ts.
        // It uses INSERT ... ON CONFLICT ("userId") DO UPDATE ...
        // So if user doesn't exist, it will try to insert. If there's a foreign key on userId to User.id, it will fail.
        
        const processed = await service.processBatch();
        expect(processed).toBe(1); // It fetches 1 update

        // Wait, AnalyticsService catches error and returns false for flushToDatabase
        // Then it calls requeueFailedUsers.
        
        const dirty = await redis.sismember("usage:dirty_users", userId);
        expect(dirty).toBe(1); // Should be requeued
    });
});
