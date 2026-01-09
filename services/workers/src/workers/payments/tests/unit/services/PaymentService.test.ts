import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockUserUpdateMany, mockUserFindUnique } from "../../mocks/db";
import { redisMock, mockRedisDel } from "../../mocks/redis";
import { configMock } from "../../mocks/config";
import { lockMock, mockAcquire, mockRelease } from "../../mocks/locks";
import { getSubscriptionCreatedEvent, getSubscriptionCanceledEvent, getUserCancelRequestEvent } from "../../fixtures/paddleEvents";
import { CacheKeys } from "@shared/cache/keys";

mock.module("@shared/db", () => prismaMock);
mock.module("@shared/redis", () => redisMock);
mock.module("@shared/cache/lock", () => lockMock);
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
        mockAcquire.mockClear();
        mockRelease.mockClear();
        mockFetch.mockClear();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("should acquire locks, update user, invalidate cache, and release locks", async () => {
        const event = getSubscriptionCreatedEvent();
        const userId = "user_abc";
        const email = "test@example.com";
        
        mockUserUpdate.mockResolvedValueOnce({ email });

        await service.handleEvent(event as any);

        expect(mockUserUpdate).toHaveBeenCalled();
        const callArgs = (mockUserUpdate.mock.calls as any)[0][0];
        expect(callArgs.where.id).toBe(userId);

        expect(mockAcquire).toHaveBeenCalledTimes(2);
        expect(mockAcquire).toHaveBeenCalledWith(CacheKeys.user(userId));
        expect(mockAcquire).toHaveBeenCalledWith(CacheKeys.userByEmail(email));

        expect(mockRedisDel).toHaveBeenCalled();
        const redisArgs = mockRedisDel.mock.calls[0] as string[];
        expect(redisArgs).toContain(CacheKeys.user(userId));
        expect(redisArgs).toContain(CacheKeys.userByEmail(email));

        expect(mockRelease).toHaveBeenCalledTimes(2);
    });

    test("should handle cancellation, acquire locks, and invalidate cache", async () => {
        const event = getSubscriptionCanceledEvent();
        const userId = "user_abc";
        const email = "cancel@example.com";

        mockUserFindUnique.mockResolvedValueOnce({ email });

        await service.handleEvent(event as any);

        expect(mockUserFindUnique).toHaveBeenCalledTimes(1);
        expect(mockUserUpdateMany).toHaveBeenCalled();

        expect(mockAcquire).toHaveBeenCalledTimes(2);
        expect(mockRedisDel).toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalledTimes(2);
    });

    test("should still attempt to delete cache if locking fails (fallback)", async () => {
        const event = getSubscriptionCreatedEvent();
        const userId = "user_abc";
        const email = "test@example.com";

        mockUserUpdate.mockResolvedValueOnce({ email });
        mockAcquire.mockRejectedValue(new Error("Redis Lock Error"));

        await service.handleEvent(event as any);

        expect(mockRedisDel).toHaveBeenCalled();
    });

    test("should call external API when user requests cancellation", async () => {
        const event = getUserCancelRequestEvent();
        await service.handleEvent(event as any);

        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockRedisDel).not.toHaveBeenCalled();
        expect(mockAcquire).not.toHaveBeenCalled();
        
        expect(mockFetch).toHaveBeenCalled();
    });
});