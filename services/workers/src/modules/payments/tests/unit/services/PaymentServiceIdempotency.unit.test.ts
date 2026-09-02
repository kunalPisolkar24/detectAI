import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({ Logger: mockLogger }));

const { PaymentService } = await import("../../../application/services/PaymentService");

const createMetricsMock = () => {
  const jobTimer = mock();
  return ({
    jobDuration: { startTimer: mock(() => jobTimer) },
    jobTimer,
    jobTotal: { inc: mock() },
    jobErrors: { inc: mock() },
    activeJobs: { inc: mock(), dec: mock() },
    unhandledEventsTotal: { inc: mock() },
    workerDuplicateEventsTotal: { inc: mock() },
    staleEventsFilteredTotal: { inc: mock() },
    workerIdempotencyRedisErrorsTotal: { inc: mock() },
  });
};

describe("PaymentService idempotency", () => {
  let metricsMock: ReturnType<typeof createMetricsMock>;
  let mockHandler: { handle: ReturnType<typeof mock> };
  let mockIdempotency: { isDuplicate: ReturnType<typeof mock>; markProcessed: ReturnType<typeof mock> };

  beforeEach(() => {
    metricsMock = createMetricsMock();
    mockHandler = { handle: mock(() => Promise.resolve()) };
    mockIdempotency = {
      isDuplicate: mock(() => Promise.resolve(false)),
      markProcessed: mock(() => Promise.resolve()),
    };
    mockLogger.info.mockClear();
  });

  const buildService = () =>
    new PaymentService(
      { "subscription.updated": mockHandler as any },
      metricsMock as any,
      mockIdempotency as any,
    );

  test("replay same event_id 5x filters 4 duplicates", async () => {
    const service = buildService();
    const event = {
      event_id: "evt_test_123",
      event_type: "subscription.updated",
      occurred_at: "2024-01-01T00:00:00Z",
      data: { custom_data: { userId: "user_1" }, id: "sub_123" },
    };

    // first call not duplicate, next 4 are duplicates
    mockIdempotency.isDuplicate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    for (let i = 0; i < 5; i++) {
      await service.handleEvent(event as any);
    }

    expect(mockHandler.handle).toHaveBeenCalledTimes(1);
    expect(metricsMock.workerDuplicateEventsTotal.inc).toHaveBeenCalledTimes(4);
    expect(metricsMock.jobTimer).toHaveBeenCalledWith({ status: "duplicate" });
    expect(mockIdempotency.markProcessed).toHaveBeenCalledTimes(1);
    expect(mockIdempotency.markProcessed).toHaveBeenCalledWith("evt_test_123", "subscription.updated");
  });

  test("different event_id with same occurred_at is not deduplicated", async () => {
    const service = buildService();
    mockIdempotency.isDuplicate.mockResolvedValue(false);

    const e1 = { event_id: "evt_1", event_type: "subscription.updated", occurred_at: "2024-01-01T00:00:00Z", data: { custom_data: { userId: "user_1" } } };
    const e2 = { event_id: "evt_2", event_type: "subscription.updated", occurred_at: "2024-01-01T00:00:00Z", data: { custom_data: { userId: "user_1" } } };

    await service.handleEvent(e1 as any);
    await service.handleEvent(e2 as any);

    expect(mockHandler.handle).toHaveBeenCalledTimes(2);
  });

  test("fallback sha256 for internal events without event_id", async () => {
    const service = buildService();
    mockIdempotency.isDuplicate.mockResolvedValue(false);
    const event = {
      event_type: "subscription.updated",
      data: { custom_data: { userId: "user_1" }, id: "sub_123" },
    };

    await service.handleEvent(event as any);

    expect(mockIdempotency.isDuplicate).toHaveBeenCalled();
    const calledId = (mockIdempotency.isDuplicate.mock.calls[0] as any)[0];
    expect(typeof calledId).toBe("string");
    expect(calledId.length).toBeGreaterThan(0);
    expect(mockHandler.handle).toHaveBeenCalledTimes(1);
  });

  test("isDuplicate true returns ACK without throwing", async () => {
    const service = buildService();
    mockIdempotency.isDuplicate.mockResolvedValue(true);
    const event = { event_id: "evt_dup", event_type: "subscription.updated", data: { custom_data: { userId: "user_1" } } };

    await expect(service.handleEvent(event as any)).resolves.toBeUndefined();
    expect(mockHandler.handle).not.toHaveBeenCalled();
    expect(metricsMock.jobTotal.inc).not.toHaveBeenCalled();
  });
});
