import { describe, test, expect, mock, beforeEach } from "bun:test";
import { redisFactoryMock, mockRedisClient } from "../../mocks/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { CacheKeys } from "@shared/cache/keys";

mock.module("@shared/redis", () => redisFactoryMock);
mock.module("@shared/logger", () => ({
    Logger: { info: mock(), error: mock(), warn: mock() }
}));

const { SubscriptionSweeper } = await import("../../../services/SubscriptionSweeper");

describe("SubscriptionSweeper", () => {
    let sweeper: InstanceType<typeof SubscriptionSweeper>;
    let metricsMock: MetricsService;
    let mockRelease: ReturnType<typeof mock>;
    let mockAcquire: ReturnType<typeof mock>;
    let mockUserRepository: {
        findExpiredSubscriptions: ReturnType<typeof mock>;
        bulkUpdateStatus: ReturnType<typeof mock>;
    };

    beforeEach(() => {
        mockRedisClient.del.mockClear();
        mockRelease = mock(() => Promise.resolve());
        mockAcquire = mock(() => Promise.resolve(mockRelease));

        mockUserRepository = {
            findExpiredSubscriptions: mock(() => Promise.resolve([])),
            bulkUpdateStatus: mock(() => Promise.resolve({ count: 0 })),
        };

        metricsMock = {
            jobDuration: { startTimer: mock(() => mock()) },
            jobTotal: { inc: mock() },
            jobErrors: { inc: mock() },
            cacheOperations: { inc: mock() },
        } as unknown as MetricsService;

        sweeper = new SubscriptionSweeper(
            mockUserRepository as any,
            mockRedisClient as any,
            { acquire: mockAcquire } as any,
            metricsMock
        );
    });

    test("should return 0 and do nothing if lock cannot be acquired", async () => {
        mockAcquire.mockResolvedValue(null);
        const count = await sweeper.processExpiredSubscriptions();
        expect(count).toBe(0);
        expect(mockUserRepository.findExpiredSubscriptions).not.toHaveBeenCalled();
    });

    test("should return 0 and do nothing if no expired subscriptions found", async () => {
        mockUserRepository.findExpiredSubscriptions.mockResolvedValue([]);
        const count = await sweeper.processExpiredSubscriptions();
        expect(count).toBe(0);
        expect(mockUserRepository.bulkUpdateStatus).not.toHaveBeenCalled();
        expect(mockRedisClient.del).not.toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalled();
    });

    test("should downgrade users and invalidate cache", async () => {
        const expiredUsers = [
            { id: "u1", email: "u1@test.com" },
            { id: "u2", email: "u2@test.com" }
        ];
        mockUserRepository.findExpiredSubscriptions.mockResolvedValue(expiredUsers);
        mockUserRepository.bulkUpdateStatus.mockResolvedValue({ count: 2 });

        const count = await sweeper.processExpiredSubscriptions();

        expect(count).toBe(2);
        expect(mockUserRepository.bulkUpdateStatus).toHaveBeenCalledWith(
            ["u1", "u2"],
            expect.objectContaining({ status: "CANCELED" })
        );

        const delArgs = mockRedisClient.del.mock.calls[0] as string[];
        expect(delArgs).toContain(CacheKeys.user("u1"));
        expect(delArgs).toContain(CacheKeys.userByEmail("u1@test.com"));
        expect(mockRelease).toHaveBeenCalled();
    });

    test("should release lock even if db throws", async () => {
        mockUserRepository.findExpiredSubscriptions.mockResolvedValue([{ id: "u1", email: "u1@test.com" }]);
        mockUserRepository.bulkUpdateStatus.mockRejectedValue(new Error("DB Fail"));

        await expect(sweeper.processExpiredSubscriptions()).rejects.toThrow("DB Fail");
        expect(mockRedisClient.del).not.toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalled();
    });

    test("should continue and return count if redis invalidation fails", async () => {
        mockUserRepository.findExpiredSubscriptions.mockResolvedValue([{ id: "u1", email: "u1@test.com" }]);
        mockUserRepository.bulkUpdateStatus.mockResolvedValue({ count: 1 });
        mockRedisClient.del.mockRejectedValue(new Error("Redis Fail"));

        const count = await sweeper.processExpiredSubscriptions();
        expect(count).toBe(1);
        expect(mockRelease).toHaveBeenCalled();
    });
});