import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({ Logger: mockLogger }));

const { IdempotencyStore } = await import("../IdempotencyStore");

const createRedisMock = () => ({
  set: mock<() => Promise<string | null>>(() => Promise.resolve("OK")),
  get: mock<() => Promise<string | null>>(() => Promise.resolve(null)),
});

const createPrismaMock = () => ({
  processedWebhook: {
    findUnique: mock<() => Promise<any>>(() => Promise.resolve(null)),
    create: mock<() => Promise<any>>(() => Promise.resolve({})),
  },
});

const createMetricsMock = () => ({
  workerDuplicateEventsTotal: { inc: mock() },
  workerIdempotencyRedisErrorsTotal: { inc: mock() },
  staleEventsFilteredTotal: { inc: mock() },
});

describe("IdempotencyStore", () => {
  let redis: ReturnType<typeof createRedisMock>;
  let prisma: ReturnType<typeof createPrismaMock>;
  let metrics: ReturnType<typeof createMetricsMock>;
  let store: InstanceType<typeof IdempotencyStore>;

  beforeEach(() => {
    redis = createRedisMock();
    prisma = createPrismaMock();
    metrics = createMetricsMock();
    store = new IdempotencyStore(redis as any, prisma as any, metrics as any);
    mockLogger.warn.mockClear();
    mockLogger.info.mockClear();
  });

  test("isDuplicate returns false and sets NX EX 7d on first claim", async () => {
    redis.set.mockResolvedValue("OK");

    const result = await store.isDuplicate("evt_test_123");

    expect(result).toBe(false);
    expect(redis.set).toHaveBeenCalledWith("paddle:evt:evt_test_123", "1", "EX", 604800, "NX");
    expect(prisma.processedWebhook.findUnique).not.toHaveBeenCalled();
  });

  test("isDuplicate returns true when Redis NX fails (duplicate)", async () => {
    redis.set.mockResolvedValue(null);

    const result = await store.isDuplicate("evt_test_123");

    expect(result).toBe(true);
    expect(redis.set).toHaveBeenCalledWith("paddle:evt:evt_test_123", "1", "EX", 604800, "NX");
  });

  test("isDuplicate handles cluster return 1 as success", async () => {
    redis.set.mockResolvedValue(1 as any);

    const result = await store.isDuplicate("evt_cluster");

    expect(result).toBe(false);
  });

  test("isDuplicate falls back to DB on Redis error and returns true if found", async () => {
    redis.set.mockRejectedValue(new Error("Redis down"));
    prisma.processedWebhook.findUnique.mockResolvedValue({ eventId: "evt_test_123" });

    const result = await store.isDuplicate("evt_test_123");

    expect(result).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(metrics.workerIdempotencyRedisErrorsTotal.inc).toHaveBeenCalled();
    expect(prisma.processedWebhook.findUnique).toHaveBeenCalledWith({ where: { eventId: "evt_test_123" } });
  });

  test("isDuplicate falls back to DB and returns false if not found", async () => {
    redis.set.mockRejectedValue(new Error("Redis down"));
    prisma.processedWebhook.findUnique.mockResolvedValue(null);

    const result = await store.isDuplicate("evt_new");

    expect(result).toBe(false);
  });

  test("isDuplicate fail-open when both Redis and DB fail", async () => {
    redis.set.mockRejectedValue(new Error("Redis down"));
    prisma.processedWebhook.findUnique.mockRejectedValue(new Error("DB down"));

    const result = await store.isDuplicate("evt_test");

    expect(result).toBe(false);
  });

  test("markProcessed creates DB row and ignores P2002 duplicate", async () => {
    prisma.processedWebhook.create.mockResolvedValue({} as any);

    await store.markProcessed("evt_test_123", "subscription.updated");

    expect(prisma.processedWebhook.create).toHaveBeenCalledWith({
      data: { eventId: "evt_test_123", eventType: "subscription.updated" },
    });
  });

  test("markProcessed ignores unique constraint violation", async () => {
    prisma.processedWebhook.create.mockRejectedValue({ code: "P2002", message: "Unique constraint" });

    await expect(store.markProcessed("evt_dup", "subscription.updated")).resolves.toBeUndefined();
  });
});
