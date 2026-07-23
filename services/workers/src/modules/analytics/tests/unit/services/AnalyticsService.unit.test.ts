import { describe, test, expect, mock, beforeEach } from "bun:test";
import { mockMainClient } from "../../mocks/redis";
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
      mockMainClient as any,
      metricsMock
    );
  });

  test("should increment usage and invalidate cache", async () => {
    await service.handleUsageEvent("user_1", 10);

    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_1", 10);
    expect(mockMainClient.del).toHaveBeenCalledWith("user:id:user_1");
    expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "usage_event" });
    expect(metricsMock.domainOperationsVolume.inc).toHaveBeenCalledWith({ operation_type: "usage_flushed" }, 10);
  });

  test("should propagate error on db failure", async () => {
    mockUserRepository.incrementUsage.mockRejectedValue(new Error("DB Connection Error"));

    await expect(service.handleUsageEvent("user_1", 5)).rejects.toThrow("DB Connection Error");
    expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({ job_type: "usage_event", error_type: "db_error" });
    expect(mockMainClient.del).not.toHaveBeenCalled();
  });
});
