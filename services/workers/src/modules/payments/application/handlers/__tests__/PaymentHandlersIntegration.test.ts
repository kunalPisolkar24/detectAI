import { expect, test, describe, beforeEach, spyOn } from "bun:test";
import "../../../../../tests/setup-integration";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { SubscriptionCanceledHandler } from "../SubscriptionCanceledHandler";
import { PaymentService } from "../../services/PaymentService";
import { SubscriptionStatus } from "../../../../../../generated/prisma/client";

describe("PaymentHandlers Integration", () => {
    let redis: any;
    let eventRedis: any;
    let userRepository: PrismaUserRepository;
    let metrics: MetricsService;

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
        metrics = new MetricsService("test-payments");
        userRepository = new PrismaUserRepository(prismaPrimary, prisma);
    });

    afterEach(async () => {
        await redis.quit().catch(() => {});
        await eventRedis.quit().catch(() => {});
    });

    test("should handle subscription canceled event", async () => {
        const handler = new SubscriptionCanceledHandler(userRepository, redis, eventRedis, metrics);

        // 1. Seed user with active sub
        const user = await prismaPrimary.user.create({
            data: {
                email: "canceled@example.com",
                name: "Canceled User",
                subscription: {
                    create: {
                        status: SubscriptionStatus.ACTIVE,
                        paddleSubscriptionId: "sub_to_cancel",
                        paddlePlanId: "plan_1",
                    }
                }
            }
        });

        // 2. Handle cancellation
        const eventData = {
            id: "sub_to_cancel",
            canceled_at: new Date().toISOString(),
            occurred_at: new Date().toISOString(),
        };
        await handler.handle(user.id, eventData as any);

        // 3. Verify DB
        const updatedSub = await prismaPrimary.subscription.findUnique({
            where: { userId: user.id }
        });
        expect(updatedSub?.status).toBe(SubscriptionStatus.CANCELED);
        expect(updatedSub?.paddleSubscriptionId).toBeNull();
    });

    test("should route events through PaymentService", async () => {
        const mockHandler = {
            handle: async () => {}
        };
        const handleSpy = spyOn(mockHandler, "handle");

        const paymentService = new PaymentService(
            { "subscription.updated": mockHandler as any },
            metrics
        );

        const event = {
            event_type: "subscription.updated",
            data: {
                custom_data: { userId: "user_123" },
                id: "sub_123"
            }
        };

        await paymentService.handleEvent(event as any);

        expect(handleSpy).toHaveBeenCalled();
        const callArgs = handleSpy.mock.calls[0];
        expect(callArgs?.[0]).toBe("user_123");
    });
});
