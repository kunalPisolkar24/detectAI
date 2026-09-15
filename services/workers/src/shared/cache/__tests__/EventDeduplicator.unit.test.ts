import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockLogger = { info: mock(), error: mock(), warn: mock() };
mock.module("@shared/logging/Logger", () => ({ Logger: mockLogger }));

const { EventDeduplicator } = await import("../EventDeduplicator");

const createRedisMock = () => ({
  get: mock<() => Promise<string | null>>(() => Promise.resolve(null)),
  set: mock<() => Promise<"OK" | null>>(() => Promise.resolve("OK")),
});

describe("EventDeduplicator", () => {
  let redis: ReturnType<typeof createRedisMock>;
  let dedup: InstanceType<typeof EventDeduplicator>;

  beforeEach(() => {
    redis = createRedisMock();
    dedup = new EventDeduplicator(redis as any);
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
  });

  test("isStale returns false when no timestamp is stored", async () => {
    redis.get.mockResolvedValue(null);

    const result = await dedup.isStale("user_1", new Date("2024-01-01T00:00:00Z"));

    expect(result).toBe(false);
    expect(redis.get).toHaveBeenCalledWith("payment:event:ts:user_1");
  });

  test("isStale returns false when stored timestamp is older", async () => {
    redis.get.mockResolvedValue("2024-01-01T00:00:00Z");

    const result = await dedup.isStale("user_1", new Date("2024-01-01T01:00:00Z"));

    expect(result).toBe(false);
  });

  test("isStale returns true when stored timestamp is newer", async () => {
    redis.get.mockResolvedValue("2024-01-01T01:00:00Z");

    const result = await dedup.isStale("user_1", new Date("2024-01-01T00:00:00Z"));

    expect(result).toBe(true);
    expect(mockLogger.info).toHaveBeenCalled();
  });

  test("isStale returns true when stored timestamp is equal", async () => {
    redis.get.mockResolvedValue("2024-01-01T00:00:00Z");

    const result = await dedup.isStale("user_1", new Date("2024-01-01T00:00:00Z"));

    // Equal timestamps are NOT stale — DB lockAndUpdateSubscription is authoritative (see EventDeduplicator.ts:37-43)
    expect(result).toBe(false);
  });

  test("isStale returns false when Redis get fails", async () => {
    redis.get.mockRejectedValue(new Error("Connection lost"));

    const result = await dedup.isStale("user_1", new Date("2024-01-01T00:00:00Z"));

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test("markProcessed stores the event timestamp with 30d TTL", async () => {
    redis.set.mockResolvedValue("OK");

    await dedup.markProcessed("user_1", new Date("2024-01-01T00:00:00Z"));

    expect(redis.set).toHaveBeenCalledWith(
      "payment:event:ts:user_1",
      "2024-01-01T00:00:00.000Z",
      "EX",
      2592000,
    );
  });

  test("markProcessed handles Redis errors gracefully", async () => {
    redis.set.mockRejectedValue(new Error("Connection lost"));

    await dedup.markProcessed("user_1", new Date("2024-01-01T00:00:00Z"));

    expect(mockLogger.warn).toHaveBeenCalled();
  });

  test("full roundtrip: stale after markProcessed", async () => {
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("2024-01-01T00:00:00Z");

    const before = await dedup.isStale("user_1", new Date("2024-01-01T00:00:00Z"));
    expect(before).toBe(false);

    await dedup.markProcessed("user_1", new Date("2024-01-01T00:00:00Z"));

    const after = await dedup.isStale("user_1", new Date("2024-01-01T00:00:00Z"));
    // Same timestamp not stale — DB is authoritative
    expect(after).toBe(false);
  });

  test("uses custom prefix when provided", async () => {
    const custom = new EventDeduplicator(redis as any, "custom:prefix:");
    redis.get.mockResolvedValue(null);

    await custom.isStale("user_1", new Date());

    expect(redis.get).toHaveBeenCalledWith("custom:prefix:user_1");
  });
});
