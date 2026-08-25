import { expect, test, describe, beforeEach } from "bun:test";
import { CacheKeys } from "@shared/cache/keys";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { AnalyticsService } from "../AnalyticsService";
import { UsageEventDeduplicator } from "../../../infrastructure/UsageEventDeduplicator";

describe("AnalyticsService Integration", () => {
    let service: AnalyticsService;
    let redis: any;
    let userRepository: PrismaUserRepository;
    let usageDeduplicator: UsageEventDeduplicator;

    beforeEach(async () => {
        redis = RedisFactory.createClient({
            mode: "standalone",
            name: "test-redis",
            url: process.env.REDIS_URL,
        });
        const metrics = new MetricsService("test-analytics");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
        usageDeduplicator = new UsageEventDeduplicator(redis);
        service = new AnalyticsService(userRepository, redis, metrics, usageDeduplicator);
    });

    test("should handle usage event: increment db and invalidate cache", async () => {
        const user = await prismaPrimary.user.create({
            data: {
                email: "analytics-handle-event@example.com",
                name: "Analytics Event User",
            },
        });

        const userId = user.id;
        await redis.set(CacheKeys.user(userId), "cached-data");

        await service.handleUsageEvent(userId, 10);

        const usage = await prismaPrimary.usage.findUnique({ where: { userId } });
        expect(usage?.apiCallCountTotal).toBe(10);

        const cached = await redis.get(CacheKeys.user(userId));
        expect(cached).toBeNull();
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
