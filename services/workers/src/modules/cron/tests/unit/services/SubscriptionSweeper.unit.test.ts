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
        expireDueSubscriptions: ReturnType<typeof mock>;
    };

    beforeEach(() => {
        mockRedisClient.del.mockClear();

        mockUserRepository = {
            expireDueSubscriptions: mock(() => Promise.resolve([])),
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
        mockUserRepository.expireDueSubscriptions.mockResolvedValue([]);

        const count = await sweeper.processExpiredSubscriptions();

        expect(count).toBe(0);
        expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    test("should invalidate cache once per batch after the transactional sweep", async () => {
        const expiredUsers = [
            { id: "u1", email: "u1@test.com" },
            { id: "u2", email: "u2@test.com" }
        ];
        mockUserRepository.expireDueSubscriptions.mockResolvedValue(expiredUsers);

        const count = await sweeper.processExpiredSubscriptions();

        expect(count).toBe(2);
        expect(mockUserRepository.expireDueSubscriptions).toHaveBeenCalledTimes(1);

        const call = mockUserRepository.expireDueSubscriptions.mock.calls[0]! as [number, { status: string; eventTimestamp?: Date }, Date];
        expect(call[0]).toBe(100);
        expect(call[1].status).toBe("CANCELED");
        expect(call[2]).toBeInstanceOf(Date);
        expect(call[1].eventTimestamp).toBe(call[2]);

        expect(mockRedisClient.del).toHaveBeenCalledTimes(1);
        const delArgs = mockRedisClient.del.mock.calls[0] as string[];
        expect(delArgs).toContain(CacheKeys.user("u1"));
        expect(delArgs).toContain(CacheKeys.userByEmail("u1@test.com"));
        expect(delArgs).toContain(CacheKeys.user("u2"));
        expect(delArgs).toContain(CacheKeys.userByEmail("u2@test.com"));
    });

    test("should propagate error if db throws", async () => {
        mockUserRepository.expireDueSubscriptions.mockRejectedValue(new Error("DB Fail"));

        await expect(sweeper.processExpiredSubscriptions()).rejects.toThrow("DB Fail");
    });

    test("should honour a custom batch size", async () => {
        mockUserRepository.expireDueSubscriptions.mockResolvedValue([]);

        const customSweeper = new SubscriptionSweeper(
            mockUserRepository as any,
            mockRedisClient as any,
            metricsMock,
            10
        );
        await customSweeper.processExpiredSubscriptions();

        expect(mockUserRepository.expireDueSubscriptions.mock.calls[0]![0]).toBe(10);
    });

    test("should continue and return count if redis invalidation fails", async () => {
        mockUserRepository.expireDueSubscriptions.mockResolvedValue([{ id: "u1", email: "u1@test.com" }]);
        mockRedisClient.del.mockRejectedValue(new Error("Redis Fail"));

        const count = await sweeper.processExpiredSubscriptions();

        expect(count).toBe(1);
    });
});
