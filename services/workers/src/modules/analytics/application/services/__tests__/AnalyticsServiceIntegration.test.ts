import { expect, test, describe, beforeEach } from "bun:test";
import { CacheKeys } from "@shared/cache/keys";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { AnalyticsService } from "../AnalyticsService";
import { UsageEventDeduplicator } from "../../../infrastructure/UsageEventDeduplicator";

describe("AnalyticsService Integration", () => {
    let service: AnalyticsService;
    let redis: any;
    let userRepository: PrismaUserRepository;
    let usageDeduplicator: UsageEventDeduplicator;

    beforeEach(async () => {
        redis = RedisFactory.createClient({
                    name: "test-redis",
            url: process.env.REDIS_URL,
        });
        const metrics = new MetricsService("test-analytics");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
        // Dedup lives in redis-cache (same instance as counters).
        usageDeduplicator = new UsageEventDeduplicator(redis);
        service = new AnalyticsService(userRepository, metrics, usageDeduplicator);
    });

    test("should handle usage event: increment db without touching user cache", async () => {
        const user = await prismaPrimary.user.create({
            data: {
                email: "analytics-handle-event@example.com",
                name: "Analytics Event User",
            },
        });

        const userId = user.id;
        // Split layout: usage must NOT evict basic/sub entries.
        await redis.set(CacheKeys.userBasic(userId), "cached-data", "EX", 3600);
        await redis.set(CacheKeys.userSub(userId), "cached-sub", "EX", 600);

        await service.handleUsageEvent(userId, 10, crypto.randomUUID());

        const usage = await prismaPrimary.usage.findUnique({ where: { userId } });
        expect(usage?.apiCallCountTotal).toBe(10);

        expect(await redis.get(CacheKeys.userBasic(userId))).toBe("cached-data");
        expect(await redis.get(CacheKeys.userSub(userId))).toBe("cached-sub");
    });

    test("should count duplicate event ids exactly once", async () => {
        const user = await prismaPrimary.user.create({
            data: { email: "analytics-duplicate-event@example.com" },
        });

        const eventId = crypto.randomUUID();
        await service.handleUsageEvent(user.id, 5, eventId);
        await service.handleUsageEvent(user.id, 5, eventId);

        const usage = await prismaPrimary.usage.findUnique({ where: { userId: user.id } });
        expect(usage?.apiCallCountTotal).toBe(5);
    });
});
