import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockUserUpdateMany, mockUserFindUnique } from "../../mocks/db";
import { redisMock, mockRedisDel } from "../../mocks/redis";
import { configMock } from "../../mocks/config";
import { getSubscriptionCreatedEvent, getSubscriptionCanceledEvent, getUserCancelRequestEvent } from "../../fixtures/paddleEvents";

mock.module("@shared/db", () => prismaMock);
mock.module("@shared/redis", () => redisMock);
mock.module("../../../config", () => configMock);

const { PaymentService } = await import("../../../services/PaymentService");

const originalFetch = global.fetch;
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }))));

describe("PaymentService", () => {
    let service: InstanceType<typeof PaymentService>;

    beforeEach(() => {
        service = new PaymentService();
        mockUserUpdate.mockClear();
        mockUserUpdateMany.mockClear();
        mockUserFindUnique.mockClear();
        mockRedisDel.mockClear();
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("should update user details and invalidate all cache keys when subscription is created", async () => {
        const event = getSubscriptionCreatedEvent();
        const userId = "user_abc";
        const email = "test@example.com";
        
        mockUserUpdate.mockResolvedValueOnce({ email });

        await service.handleEvent(event as any);

        expect(mockUserUpdate).toHaveBeenCalled();
        const callArgs = (mockUserUpdate.mock.calls as any)[0][0];
        expect(callArgs.where.id).toBe(userId);
        expect(callArgs.data.paddleSubscriptionStatus).toBe("ACTIVE");

        expect(mockRedisDel).toHaveBeenCalled();
        const redisArgs = mockRedisDel.mock.calls[0] as string[];
        
        expect(redisArgs).toHaveLength(3);
        expect(redisArgs).toContain(`user:${userId}`);
        expect(redisArgs).toContain(`user:id:${userId}`);
        expect(redisArgs).toContain(`user:email:${email}`);
    });

    test("should fetch user email, mark subscription as canceled, and invalidate all cache keys", async () => {
        const event = getSubscriptionCanceledEvent();
        const userId = "user_abc";
        const email = "cancel@example.com";

        mockUserFindUnique.mockResolvedValueOnce({ email });

        await service.handleEvent(event as any);

        expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
        const findArgs = (mockUserFindUnique.mock.calls as any)[0][0];
        expect(findArgs.where.id).toBe(userId);

        expect(mockUserUpdateMany).toHaveBeenCalled();
        const updateArgs = (mockUserUpdateMany.mock.calls as any)[0][0];
        expect(updateArgs.where.paddleSubscriptionId).toBe("sub_123");
        expect(updateArgs.data.paddleSubscriptionStatus).toBe("CANCELED");

        expect(mockRedisDel).toHaveBeenCalled();
        const redisArgs = mockRedisDel.mock.calls[0] as string[];
        
        expect(redisArgs).toHaveLength(3);
        expect(redisArgs).toContain(`user:${userId}`);
        expect(redisArgs).toContain(`user:id:${userId}`);
        expect(redisArgs).toContain(`user:email:${email}`);
    });

    test("should call external API when user requests cancellation", async () => {
        const event = getUserCancelRequestEvent();
        await service.handleEvent(event as any);

        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockRedisDel).not.toHaveBeenCalled();
        
        expect(mockFetch).toHaveBeenCalled();
        const url = (mockFetch.mock.calls as any)[0][0] as string;
        expect(url).toContain("/subscriptions/sub_to_cancel/cancel");
    });
});