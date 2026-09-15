import { describe, test, expect, mock, beforeEach } from "bun:test";
import { UsageEventDeduplicator } from "../../../infrastructure/UsageEventDeduplicator";
import { MetricsService } from "@shared/monitoring/MetricsService";

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
      metricsMock
    );
  });

  const buildServiceWithDedupe = (dedupe: { tryBegin: ReturnType<typeof mock>; release?: ReturnType<typeof mock> }) =>
    new AnalyticsService(
      mockUserRepository as any,
      metricsMock,
      dedupe as unknown as UsageEventDeduplicator
    );

  test("should skip processing when event was already seen", async () => {
    const tryBegin = mock(() => Promise.resolve(false));
    const dedupedService = buildServiceWithDedupe({ tryBegin });

    await dedupedService.handleUsageEvent("user_1", 10, "123e4567-e89b-12d3-a456-426614174000");

    expect(tryBegin).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174000");
    expect(mockUserRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test("should increment usage without touching user cache (split layout)", async () => {
    const tryBegin = mock(() => Promise.resolve(true));
    const release = mock(() => Promise.resolve());
    const dedupedService = buildServiceWithDedupe({ tryBegin, release });

    await dedupedService.handleUsageEvent("user_1", 10, "123e4567-e89b-12d3-a456-426614174001");

    expect(tryBegin).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174001");
    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_1", 10);
    expect(release).not.toHaveBeenCalled();
    expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "usage_event" });
  });

  test("should reject events without eventId (dedup would be bypassed)", async () => {
    await expect(service.handleUsageEvent("user_1", 3, "" as any)).rejects.toThrow(/eventId/);
    expect(mockUserRepository.incrementUsage).not.toHaveBeenCalled();
  });

  test("should increment usage with no dedup configured", async () => {
    await service.handleUsageEvent("user_1", 10, "123e4567-e89b-12d3-a456-426614174002");

    expect(mockUserRepository.incrementUsage).toHaveBeenCalledWith("user_1", 10);
    expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "usage_event" });
    expect(metricsMock.domainOperationsVolume.inc).toHaveBeenCalledWith({ operation_type: "usage_flushed" }, 10);
  });

  test("should release dedup claim and propagate error on db failure", async () => {
    const tryBegin = mock(() => Promise.resolve(true));
    const release = mock(() => Promise.resolve());
    const dedupedService = buildServiceWithDedupe({ tryBegin, release });
    mockUserRepository.incrementUsage.mockRejectedValue(new Error("DB Connection Error"));

    await expect(dedupedService.handleUsageEvent("user_1", 5, "123e4567-e89b-12d3-a456-426614174003")).rejects.toThrow("DB Connection Error");
    expect(release).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174003");
    expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({ job_type: "usage_event", error_type: "db_error" });
  });
});
