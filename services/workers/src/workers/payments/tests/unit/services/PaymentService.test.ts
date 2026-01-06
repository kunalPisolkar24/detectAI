import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockUserUpdateMany } from "../../mocks/db";
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
        mockRedisDel.mockClear();
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("should update user details and invalidate cache when subscription is created", async () => {
        const event = getSubscriptionCreatedEvent();
        
        mockUserUpdate.mockResolvedValueOnce({ email: "test@example.com" });

        await service.handleEvent(event as any);

        expect(mockUserUpdate).toHaveBeenCalled();
        const callArgs = (mockUserUpdate.mock.calls as any)[0][0];
        expect(callArgs.where.id).toBe("user_abc");
        expect(callArgs.data.paddleSubscriptionStatus).toBe("ACTIVE");

        expect(mockRedisDel).toHaveBeenCalled();
        const redisArgs = mockRedisDel.mock.calls[0] as string[];
        expect(redisArgs).toContain("user:id:user_abc");
        expect(redisArgs).toContain("user:email:test@example.com");
    });

    test("should mark subscription as canceled and invalidate cache when receiving canceled event", async () => {
        const event = getSubscriptionCanceledEvent();
        await service.handleEvent(event as any);

        expect(mockUserUpdateMany).toHaveBeenCalled();
        const callArgs = (mockUserUpdateMany.mock.calls as any)[0][0];
        expect(callArgs.where.paddleSubscriptionId).toBe("sub_123");
        expect(callArgs.data.paddleSubscriptionStatus).toBe("CANCELED");

        expect(mockRedisDel).toHaveBeenCalled();
        const redisArgs = mockRedisDel.mock.calls[0] as string[];
        expect(redisArgs).toContain("user:id:user_abc");
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