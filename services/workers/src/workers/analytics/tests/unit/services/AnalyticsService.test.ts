import { describe, test, expect, mock, beforeEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockPrismaTransaction } from "../../mocks/db";
import { redisMock, mockRedisClient, mockRedisSpop, mockPipelineExec, mockRedisSadd, mockRedisGet, mockRedisExec, mockRedisWatch, mockRedisUnwatch, mockRedisMulti } from "../../mocks/redis";
import { configMock } from "../../mocks/config";
import { CacheKeys } from "@shared/cache/keys";
import { JsonSerializer } from "@shared/cache/serialization";

mock.module("@shared/db", () => prismaMock);
mock.module("@shared/redis", () => redisMock);
mock.module("@shared/config", () => configMock);
mock.module("../../../config", () => configMock);

const { AnalyticsService } = await import("../../../services/AnalyticsService");

describe("AnalyticsService", () => {
  let service: InstanceType<typeof AnalyticsService>;

  beforeEach(() => {
    service = new AnalyticsService();
    
    mockRedisSpop.mockClear();
    mockRedisSadd.mockClear();
    mockPipelineExec.mockClear();
    mockUserUpdate.mockClear();
    mockPrismaTransaction.mockClear();
    mockRedisGet.mockClear();
    mockRedisExec.mockClear();
    mockRedisWatch.mockClear();
    mockRedisUnwatch.mockClear();
    mockRedisMulti.mockClear();
    
    (mockPipelineExec as any).mockResolvedValue([]);
  });

  test("should return 0 if no dirty users are found", async () => {
    mockRedisSpop.mockResolvedValue([]);

    const result = await service.processBatch();

    expect(result).toBe(0);
    expect(mockRedisSpop).toHaveBeenCalledWith("usage:dirty_users", 50);
    expect(mockPrismaTransaction).not.toHaveBeenCalled();
  });

  test("should process batch successfully and update database", async () => {
    const userIds = ["user_1"];
    const usageCounts = [[null, "10"]];

    mockRedisSpop.mockResolvedValue(userIds);
    
    (mockPipelineExec as any)
      .mockResolvedValueOnce(usageCounts) 
      .mockResolvedValueOnce([[null, "OK"]]); 

    mockPrismaTransaction.mockResolvedValue([{}]);
    
    mockRedisGet.mockResolvedValue(null); 

    const result = await service.processBatch();

    expect(result).toBe(1);
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    
    const calls = mockUserUpdate.mock.calls;
    const firstUpdateCall = (calls[0] as any[])[0];
    
    expect(firstUpdateCall.where.id).toBe("user_1");
    expect(firstUpdateCall.data.apiCallCountTotal.increment).toBe(10);
  });

  test("should patch cache correctly using optimistic locking", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);

    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]]) 
      .mockResolvedValueOnce([[null, "OK"]]); 

    mockPrismaTransaction.mockResolvedValue([{}]);

    const existingUser = {
      id: "user_1",
      apiCallCountTotal: 100,
      apiCallCountDaily: 20
    };
    const serializedUser = JsonSerializer.serialize(existingUser);
    
    mockRedisGet.mockResolvedValue(serializedUser);
    mockRedisExec.mockResolvedValue(["OK"]); 

    await service.processBatch();

    expect(mockRedisWatch).toHaveBeenCalledWith(CacheKeys.user("user_1"));
    expect(mockRedisGet).toHaveBeenCalledWith(CacheKeys.user("user_1"));
    expect(mockRedisMulti).toHaveBeenCalled();
    expect(mockRedisExec).toHaveBeenCalled();
  });

  test("should abort cache update if optimistic lock fails (exec returns null)", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);

    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]])
      .mockResolvedValueOnce([[null, "OK"]]);

    mockPrismaTransaction.mockResolvedValue([{}]);

    mockRedisGet.mockResolvedValue(JSON.stringify({ apiCallCountTotal: 100 }));
    mockRedisExec.mockResolvedValue(null); 

    await service.processBatch();

    expect(mockRedisWatch).toHaveBeenCalled();
    expect(mockRedisMulti).toHaveBeenCalled();
    expect(mockRedisExec).toHaveBeenCalled();
  });

  test("should unwatch and skip if cache key is missing", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);

    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]])
      .mockResolvedValueOnce([[null, "OK"]]);

    mockPrismaTransaction.mockResolvedValue([{}]);

    mockRedisGet.mockResolvedValue(null);

    await service.processBatch();

    expect(mockRedisWatch).toHaveBeenCalled();
    expect(mockRedisUnwatch).toHaveBeenCalled();
    expect(mockRedisMulti).not.toHaveBeenCalled();
  });

  test("should handle JSON deserialization errors gracefully by unwatching", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);

    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]])
      .mockResolvedValueOnce([[null, "OK"]]);

    mockPrismaTransaction.mockResolvedValue([{}]);

    mockRedisGet.mockResolvedValue("{ invalid_json: ");

    await service.processBatch();

    expect(mockRedisWatch).toHaveBeenCalled();
    expect(mockRedisUnwatch).toHaveBeenCalled();
    expect(mockRedisMulti).not.toHaveBeenCalled();
  });

  test("should requeue users if database transaction fails", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);
    
    (mockPipelineExec as any).mockResolvedValueOnce([[null, "10"]]);

    mockPrismaTransaction.mockRejectedValue(new Error("DB Error"));

    await service.processBatch();

    expect(mockPrismaTransaction).toHaveBeenCalled();
    expect(mockRedisSadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
  });

  test("should shutdown redis clients on shutdown", async () => {
    await service.shutdown();
    expect(mockRedisClient.quit).toHaveBeenCalledTimes(2);
  });
});