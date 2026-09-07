import { describe, test, expect, mock, beforeEach } from "bun:test";
import { mockMainClient } from "../../mocks/redis";
import { UsageEventDeduplicator } from "../../../infrastructure/UsageEventDeduplicator";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { CacheKeys } from "@shared/cache/keys";

const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({
  Logger: mockLogger
}));

const { AnalyticsService } = await import("../../../application/services/AnalyticsService");

describe("AnalyticsService", () => {
  let service: InstanceType<typeof AnalyticsService>;
  let metricsMock: MetricsService;
  let mockUserRepository: { incrementUsage: ReturnType<typeof mock>; findUniqueById: ReturnType<typeof mock> };

  beforeEach(() => {
    mockUserRepository = {
      incrementUsage: mock(() => Promise.resolve()),
      findUniqueById: mock(() => Promise.resolve(null)),
    };
    mockMainClient.del.mockClear();
    // also clear unlink/pipeline if present
    (mockMainClient as any).unlink?.mockClear?.();
    (mockMainClient as any).pipeline?.mockClear?.();
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
      cacheInvalidateDurationSeconds: { startTimer: mock(() => mock()) },
      cacheInvalidateRetriesTotal: { inc: mock() },
      staleEventsFilteredTotal: { inc: mock() },
    } as unknown as MetricsService;

    service = new AnalyticsService(
      mockUserRepository as any,
      mockMainClient as any,
      metricsMock
    );
  });

  const buildServiceWithDedupe = (tryBegin: ReturnType<typeof mock>) =>
    new AnalyticsService(
      mockUserRepository as any,
      mockMainClient as any,
      metricsMock,
      { tryBegin } as unknown as UsageEventDeduplicator
    );

  test("should skip processing when event was already seen", async () => {
    const tryBegin = mock(() => Promise.resolve(false));
    const dedupedService = buildServiceWithDedupe(tryBegin);

    await dedupedService.handleUsageEvent("user_1", 10, "123e4567-e89b-12d3-a456-426614174000");

    expect(tryBegin).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174000");
    expect(mockUserRepository.incrementUsage).not.toHaveBeenCalled();
    expect(mockMainClient.del).not.toHaveBeenCalled();
  });

  test("should mark fresh events before writing and swallow cache failures", async () => {
    const tryBegin = mock(() => Promise.resolve(true));
    const dedupedService = buildServiceWithDedupe(tryBegin);
    mockMainClient.del.mockRejectedValueOnce(new Error("redis down"));

    await dedupedService.handleUsageEvent("user_1", 10, "123e4567-e89b-12d3-a456-426614174001");

    expect(tryBegin).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174001");
    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_1", 10);
    expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "usage_event" });
  });

  test("should reject events without eventId (dedup would be bypassed)", async () => {
    await expect(service.handleUsageEvent("user_1", 3, "" as any)).rejects.toThrow(/eventId/);
    expect(mockUserRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test("should increment usage and invalidate cache", async () => {
    await service.handleUsageEvent("user_1", 10, "123e4567-e89b-12d3-a456-426614174002");

    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_1", 10);
    expect(mockMainClient.del).toHaveBeenCalledWith(CacheKeys.user("user_1"));
    expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "usage_event" });
    expect(metricsMock.domainOperationsVolume.inc).toHaveBeenCalledWith({ operation_type: "usage_flushed" }, 10);
  });

  test("should propagate error on db failure", async () => {
    mockUserRepository.incrementUsage.mockRejectedValue(new Error("DB Connection Error"));

    await expect(service.handleUsageEvent("user_1", 5, "123e4567-e89b-12d3-a456-426614174003")).rejects.toThrow("DB Connection Error");
    expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({ job_type: "usage_event", error_type: "db_error" });
    expect(mockMainClient.del).not.toHaveBeenCalled();
  });
});
