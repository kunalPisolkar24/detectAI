import { describe, test, expect, mock, beforeEach } from "bun:test";
import { prismaMock, mockExecuteRawUnsafe } from "../../mocks/db";
import { redisFactoryMock, mockUsageClient, mockMainClient } from "../../mocks/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";

mock.module("@shared/db", () => prismaMock);
mock.module("@shared/redis", () => redisFactoryMock);
const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logger", () => ({
  Logger: mockLogger
}));


const { AnalyticsService } = await import("../../../services/AnalyticsService");

describe("AnalyticsService", () => {
  let service: InstanceType<typeof AnalyticsService>;
  let metricsMock: MetricsService;

  beforeEach(() => {
    mockUsageClient.spop.mockClear();
    mockUsageClient.get.mockClear();
    mockUsageClient.decrby.mockClear();
    mockUsageClient.sadd.mockClear();
    mockMainClient.del.mockClear();
    mockExecuteRawUnsafe.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();


    // Setup Metrics Mock
    metricsMock = {
      jobDuration: { startTimer: mock(() => mock()) },
      jobTotal: { inc: mock() },
      jobErrors: { inc: mock() },
      cacheOperations: { inc: mock() },
    } as unknown as MetricsService;

    service = new AnalyticsService(
      mockUsageClient as any,
      mockMainClient as any,
      metricsMock
    );
  });

  test("should return 0 when no dirty users are found", async () => {
    (mockUsageClient.spop as any).mockResolvedValue([]);
    const count = await service.processBatch();
    expect(count).toBe(0);

    expect(mockUsageClient.spop).toHaveBeenCalledWith("usage:dirty_users", 50);
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
  });

  test("should process batch: fetch usage, update db, decrement redis, invalidate cache", async () => {
    const userIds = ["user_1", "user_2"];

    // 1. Get Dirty Users
    (mockUsageClient.spop as any).mockResolvedValue(userIds);

    // 2. Fetch Pending Counts (Mock return values for user_1 and user_2)
    (mockUsageClient.get as any)
      .mockResolvedValueOnce("10") // user_1
      .mockResolvedValueOnce("5");  // user_2

    // 3. Mock DB Success
    (mockExecuteRawUnsafe as any).mockResolvedValue(2);

    // 4. Mock Decrby
    (mockUsageClient.decrby as any).mockResolvedValue(0);

    // 5. Mock check after decrement (Clean state)
    (mockUsageClient.get as any)
      .mockResolvedValueOnce("0")
      .mockResolvedValueOnce("0");

    const count = await service.processBatch();

    expect(count).toBe(2);

    // Check DB Call
    expect(mockExecuteRawUnsafe).toHaveBeenCalled();
    const dbCallArg = (mockExecuteRawUnsafe as any).mock.calls[0][0] as string;

    expect(dbCallArg).toContain("'user_1', 10");
    expect(dbCallArg).toContain("'user_2', 5");

    // Check cleanup
    expect(mockUsageClient.decrby).toHaveBeenCalledTimes(2);
    expect(mockMainClient.del).toHaveBeenCalledWith("user:id:user_1", "user:id:user_2");
    expect(mockUsageClient.sadd).not.toHaveBeenCalled();
  });

  test("should requeue user if they still have pending counts after decrement", async () => {
    (mockUsageClient.spop as any).mockResolvedValue(["user_1"]);
    (mockUsageClient.get as any).mockResolvedValueOnce("20"); // Initial fetch
    (mockExecuteRawUnsafe as any).mockResolvedValue(1);

    // After decrement, user still has 5 pending (new events came in)
    (mockUsageClient.get as any).mockResolvedValueOnce("5");

    await service.processBatch();

    expect(mockUsageClient.decrby).toHaveBeenCalledWith("usage:pending:user_1", 20);
    expect(mockUsageClient.sadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
    expect(mockMainClient.del).toHaveBeenCalled(); // Should still invalidate
  });

  test("should requeue users if database update fails", async () => {
    (mockUsageClient.spop as any).mockResolvedValue(["user_1"]);
    (mockUsageClient.get as any).mockResolvedValue("10");
    (mockExecuteRawUnsafe as any).mockRejectedValue(new Error("DB Connection Error"));


    try {
      await service.processBatch();
    } catch (e) {
      // expected
    }

    expect(mockUsageClient.sadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
    expect(mockUsageClient.decrby).not.toHaveBeenCalled();
    expect(mockMainClient.del).not.toHaveBeenCalled();
  });

  test("should handle requeue failure gracefully (log error)", async () => {
    (mockUsageClient.spop as any).mockResolvedValue(["user_1"]);
    (mockUsageClient.get as any).mockResolvedValue("10");
    (mockExecuteRawUnsafe as any).mockRejectedValue(new Error("DB Error"));

    // Fail the requeue attempt
    (mockUsageClient.sadd as any).mockRejectedValue(new Error("Redis Error"));

    try {
      await service.processBatch();
    } catch { }

    expect(mockLogger.error).toHaveBeenCalledWith("CRITICAL: Failed to requeue users", expect.any(Error));
  });
});