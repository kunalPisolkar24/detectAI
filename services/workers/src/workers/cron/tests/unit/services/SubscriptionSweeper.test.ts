import { describe, test, expect, mock, beforeEach } from "bun:test";
import { prismaMock, mockFindMany, mockUpdateMany } from "../../mocks/db";
import { redisFactoryMock, mockRedisClient } from "../../mocks/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { CacheKeys } from "@shared/cache/keys";

mock.module("@shared/db", () => prismaMock);
mock.module("@shared/redis", () => redisFactoryMock);
mock.module("@shared/logger", () => ({
  Logger: { info: mock(), error: mock() }
}));

const { SubscriptionSweeper } = await import("../../../services/SubscriptionSweeper");

describe("SubscriptionSweeper", () => {
  let sweeper: InstanceType<typeof SubscriptionSweeper>;
  let metricsMock: MetricsService;

  beforeEach(() => {
    mockFindMany.mockClear();
    mockUpdateMany.mockClear();
    mockRedisClient.del.mockClear();

    metricsMock = {
      jobDuration: { startTimer: mock(() => mock()) },
      jobTotal: { inc: mock() },
      jobErrors: { inc: mock() },
      cacheOperations: { inc: mock() },
    } as unknown as MetricsService;

    sweeper = new SubscriptionSweeper(mockRedisClient as any, metricsMock);
  });

  test("should return 0 and do nothing if no expired subscriptions found", async () => {
    mockFindMany.mockResolvedValue([]);
    const count = await sweeper.processExpiredSubscriptions();
    expect(count).toBe(0);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  test("should downgrade users and invalidate cache", async () => {
    const expiredUsers = [
      { id: "u1", email: "u1@test.com" },
      { id: "u2", email: "u2@test.com" }
    ];

    mockFindMany.mockResolvedValue(expiredUsers);
    mockUpdateMany.mockResolvedValue({ count: 2 });

    const count = await sweeper.processExpiredSubscriptions();

    expect(count).toBe(2);

    // Verify DB Update
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["u1", "u2"] } },
      data: expect.objectContaining({ paddleSubscriptionStatus: "CANCELED" })
    });

    // Verify Cache Invalidation
    expect(mockRedisClient.del).toHaveBeenCalled();
    const delArgs = mockRedisClient.del.mock.calls[0] as string[];
    expect(delArgs).toContain(CacheKeys.user("u1"));
    expect(delArgs).toContain(CacheKeys.userByEmail("u1@test.com"));
  });

  test("should handle db error gracefully (throw and log)", async () => {
    mockFindMany.mockResolvedValue([{ id: "u1" }]);
    mockUpdateMany.mockRejectedValue(new Error("DB Fail"));

    expect(sweeper.processExpiredSubscriptions()).rejects.toThrow("DB Fail");
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  test("should continue if redis invalidation fails but log error", async () => {
    mockFindMany.mockResolvedValue([{ id: "u1", email: "u1@test.com" }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockRedisClient.del.mockRejectedValue(new Error("Redis Fail"));

    const count = await sweeper.processExpiredSubscriptions();
    expect(count).toBe(1); // Still returns success count for DB ops
  });
});