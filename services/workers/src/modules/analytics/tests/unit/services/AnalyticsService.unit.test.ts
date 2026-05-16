import { describe, test, expect, mock, beforeEach } from "bun:test";
import { redisFactoryMock, mockUsageClient, mockMainClient } from "../../mocks/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";
const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({
  Logger: mockLogger
}));

const { AnalyticsService } = await import("../../../application/services/AnalyticsService");

describe("AnalyticsService", () => {
  let service: InstanceType<typeof AnalyticsService>;
  let metricsMock: MetricsService;
  let mockUserRepository: { incrementUsage: ReturnType<typeof mock> };

  beforeEach(() => {
    mockUserRepository = {
      incrementUsage: mock(() => Promise.resolve())
    };
    mockUsageClient.spop.mockClear();
    mockUsageClient.get.mockClear();
    mockUsageClient.decrby.mockClear();
    mockUsageClient.sadd.mockClear();
    mockMainClient.del.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();

    metricsMock = {
      jobDuration: { startTimer: mock(() => mock()) },
      jobTotal: { inc: mock() },
      jobErrors: { inc: mock() },
      cacheOperations: { inc: mock() },
      domainOperationsVolume: { inc: mock() },
      activeJobs: { inc: mock(), dec: mock() },
      rabbitmqConnectionStatus: { set: mock() },
      rabbitmqReconnections: { inc: mock() },
      redisConnectionStatus: { set: mock() },
      messageSizeBytes: { observe: mock() },
      deadLetteredTotal: { inc: mock() },
    } as unknown as MetricsService;

    service = new AnalyticsService(
      mockUserRepository as any,
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
    expect(mockUserRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test("should process batch: fetch usage, update db, decrement redis, invalidate cache", async () => {
    const userIds = ["user_1", "user_2"];

    (mockUsageClient.spop as any).mockResolvedValue(userIds);
    (mockUsageClient.get as any)
      .mockResolvedValueOnce("10")
      .mockResolvedValueOnce("5");
    (mockUsageClient.decrby as any).mockResolvedValue(0);

    const count = await service.processBatch();

    expect(count).toBe(2);
    expect(mockUserRepository.incrementUsage).toHaveBeenCalledTimes(2);
    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_1", 10);
    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_2", 5);
    expect(mockUsageClient.decrby).toHaveBeenCalledTimes(2);
    expect(mockUsageClient.decrby).toHaveBeenCalledWith("usage:{user_1}:pending", 10);
    expect(mockUsageClient.decrby).toHaveBeenCalledWith("usage:{user_2}:pending", 5);
    expect(mockMainClient.del).toHaveBeenCalledWith("user:id:user_1", "user:id:user_2");
    expect(mockUsageClient.sadd).not.toHaveBeenCalled();
  });

  test("should requeue user if decrby returns a remaining positive count", async () => {
    (mockUsageClient.spop as any).mockResolvedValue(["user_1"]);
    (mockUsageClient.get as any).mockResolvedValueOnce("20");
    (mockUsageClient.decrby as any).mockResolvedValue(5);

    await service.processBatch();

    expect(mockUsageClient.decrby).toHaveBeenCalledWith("usage:{user_1}:pending", 20);
    expect(mockUsageClient.sadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
    expect(mockMainClient.del).toHaveBeenCalled();
  });

  test("should requeue users if database update fails", async () => {
    (mockUsageClient.spop as any).mockResolvedValue(["user_1"]);
    (mockUsageClient.get as any).mockResolvedValue("10");
    mockUserRepository.incrementUsage.mockRejectedValue(new Error("DB Connection Error"));

    try {
      await service.processBatch();
    } catch (e) {}

    expect(mockUsageClient.sadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
    expect(mockUsageClient.decrby).not.toHaveBeenCalled();
    expect(mockMainClient.del).not.toHaveBeenCalled();
  });

  test("should handle requeue failure gracefully (log error)", async () => {
    (mockUsageClient.spop as any).mockResolvedValue(["user_1"]);
    (mockUsageClient.get as any).mockResolvedValue("10");
    mockUserRepository.incrementUsage.mockRejectedValue(new Error("DB Error"));
    (mockUsageClient.sadd as any).mockRejectedValue(new Error("Redis Error"));

    try {
      await service.processBatch();
    } catch {}

    expect(mockLogger.error).toHaveBeenCalledWith("CRITICAL: Failed to requeue users", expect.any(Error));
  });
});