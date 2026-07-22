import { describe, test, expect, mock, beforeEach } from "bun:test";
import { redisFactoryMock, mockRedisClient } from "../../mocks/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { CacheKeys } from "@shared/cache/keys";


mock.module("@shared/logging/Logger", () => ({
    Logger: { info: mock(), error: mock(), warn: mock() }
}));

const { SubscriptionSweeper } = await import("../../../application/services/SubscriptionSweeper");

describe("SubscriptionSweeper", () => {
    let sweeper: InstanceType<typeof SubscriptionSweeper>;
    let metricsMock: MetricsService;
    let mockUserRepository: {
        findExpiredSubscriptionsWithLock: ReturnType<typeof mock>;
        bulkUpdateStatus: ReturnType<typeof mock>;
    };

    beforeEach(() => {
        mockRedisClient.del.mockClear();

        mockUserRepository = {
            findExpiredSubscriptionsWithLock: mock(() => Promise.resolve([])),
            bulkUpdateStatus: mock(() => Promise.resolve({ count: 0 })),
        };

        metricsMock = {
            jobDuration: { startTimer: mock(() => mock()) },
            jobTotal: { inc: mock() },
            jobErrors: { inc: mock() },
            cacheOperations: { inc: mock() },
            activeJobs: { inc: mock(), dec: mock() },
            rabbitmqConnectionStatus: { set: mock() },
            rabbitmqReconnections: { inc: mock() },
            redisConnectionStatus: { set: mock() },
            messageSizeBytes: { observe: mock() },
            deadLetteredTotal: { inc: mock() },
        } as unknown as MetricsService;

        sweeper = new SubscriptionSweeper(
            mockUserRepository as any,
            mockRedisClient as any,
            metricsMock
        );
    });

    test("should return 0 and do nothing if no expired subscriptions found", async () => {
        mockUserRepository.findExpiredSubscriptionsWithLock.mockResolvedValue([]);
        const count = await sweeper.processExpiredSubscriptions();
        expect(count).toBe(0);
        expect(mockUserRepository.bulkUpdateStatus).not.toHaveBeenCalled();
        expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    test("should downgrade users and invalidate cache", async () => {
        const expiredUsers = [
            { id: "u1", email: "u1@test.com" },
            { id: "u2", email: "u2@test.com" }
        ];
        mockUserRepository.findExpiredSubscriptionsWithLock.mockResolvedValue(expiredUsers);
        mockUserRepository.bulkUpdateStatus.mockResolvedValue({ count: 2 });

        const count = await sweeper.processExpiredSubscriptions();

        expect(count).toBe(2);
        expect(mockUserRepository.bulkUpdateStatus).toHaveBeenCalledWith(
            ["u1", "u2"],
            expect.objectContaining({ status: "CANCELED" })
        );

        expect(mockRedisClient.del).toHaveBeenCalledTimes(2);

        const firstDelArgs = mockRedisClient.del.mock.calls[0] as string[];
        expect(firstDelArgs).toContain(CacheKeys.user("u1"));
        expect(firstDelArgs).toContain(CacheKeys.userByEmail("u1@test.com"));

        const secondDelArgs = mockRedisClient.del.mock.calls[1] as string[];
        expect(secondDelArgs).toContain(CacheKeys.user("u1"));
        expect(secondDelArgs).toContain(CacheKeys.userByEmail("u1@test.com"));
    });

    test("should propagate error if db throws", async () => {
        mockUserRepository.findExpiredSubscriptionsWithLock.mockResolvedValue([{ id: "u1", email: "u1@test.com" }]);
        mockUserRepository.bulkUpdateStatus.mockRejectedValue(new Error("DB Fail"));

        await expect(sweeper.processExpiredSubscriptions()).rejects.toThrow("DB Fail");
        expect(mockRedisClient.del).toHaveBeenCalledTimes(1);
    });

    test("should continue and return count if redis invalidation fails", async () => {
        mockUserRepository.findExpiredSubscriptionsWithLock.mockResolvedValue([{ id: "u1", email: "u1@test.com" }]);
        mockUserRepository.bulkUpdateStatus.mockResolvedValue({ count: 1 });
        mockRedisClient.del.mockRejectedValue(new Error("Redis Fail"));

        const count = await sweeper.processExpiredSubscriptions();
        expect(count).toBe(1);
    });
});
