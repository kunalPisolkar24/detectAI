import { describe, test, expect, mock, beforeEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockPrismaTransaction } from "../../mocks/db";
import { redisMock, mockRedisClient, mockRedisSpop, mockPipelineExec, mockRedisSadd } from "../../mocks/redis";
import { configMock } from "../../mocks/config";

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
    const userIds = ["user_1", "user_2"];
    const usageCounts = [
      [null, "10"],
      [null, "5"] 
    ];

    mockRedisSpop.mockResolvedValue(userIds);
    
    (mockPipelineExec as any)
      .mockResolvedValueOnce(usageCounts) 
      .mockResolvedValueOnce(usageCounts) 
      .mockResolvedValueOnce([ 
        [null, JSON.stringify({ apiCallCountTotal: 100, apiCallCountDaily: 10 })], 
        [null, JSON.stringify({ id: "user_1" })], 
        [null, null], 
        [null, null] 
      ])
      .mockResolvedValueOnce([[null, "OK"]]); 

    mockPrismaTransaction.mockResolvedValue([{}, {}]);

    const result = await service.processBatch();

    expect(result).toBe(2);
    expect(mockPrismaTransaction).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).toHaveBeenCalledTimes(2);
    
    const calls = mockUserUpdate.mock.calls;
    // Cast to any[] to avoid strict tuple index errors on mocked calls
    const firstUpdateCall = (calls[0] as any[])[0];
    
    expect(firstUpdateCall.where.id).toBe("user_1");
    expect(firstUpdateCall.data.apiCallCountTotal.increment).toBe(10);
  });

  test("should skip users with no pending usage in redis", async () => {
    const userIds = ["user_1", "user_2"];
    mockRedisSpop.mockResolvedValue(userIds);
    
    (mockPipelineExec as any).mockResolvedValueOnce([
      [null, "10"],
      [null, null] 
    ]);
    
    mockPrismaTransaction.mockResolvedValue([{}]);

    const result = await service.processBatch();

    expect(result).toBe(1);
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    
    const calls = mockUserUpdate.mock.calls;
    expect((calls[0] as any[])[0].where.id).toBe("user_1");
  });

  test("should requeue users if database transaction fails", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);
    
    (mockPipelineExec as any).mockResolvedValueOnce([
      [null, "10"]
    ]);

    mockPrismaTransaction.mockRejectedValue(new Error("DB Error"));

    const result = await service.processBatch();

    expect(result).toBe(1); 
    expect(mockPrismaTransaction).toHaveBeenCalled();
    expect(mockRedisSadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
  });

  test("should requeue users if decrement operation reveals remaining usage", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);
    
    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]]) 
      .mockResolvedValueOnce([[null, 5]])
      .mockResolvedValueOnce([]); 

    mockPrismaTransaction.mockResolvedValue([{}]);

    await service.processBatch();

    expect(mockRedisSadd).toHaveBeenCalledWith("usage:dirty_users", "user_1");
  });

  test("should patch cache correctly when cache hits occur", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);

    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]])
      .mockResolvedValueOnce([[null, 0]]) 
      .mockResolvedValueOnce([ 
        [null, JSON.stringify({ apiCallCountTotal: 100, apiCallCountDaily: 20 })], 
        [null, null]
      ])
      .mockResolvedValueOnce([[null, "OK"]]); 

    mockPrismaTransaction.mockResolvedValue([{}]);

    await service.processBatch();

    expect(mockRedisClient.pipeline).toHaveBeenCalled();
  });
  
  test("should handle json parse errors in cache patching gracefully", async () => {
    const userIds = ["user_1"];
    mockRedisSpop.mockResolvedValue(userIds);

    (mockPipelineExec as any)
      .mockResolvedValueOnce([[null, "10"]]) 
      .mockResolvedValueOnce([[null, 0]]) 
      .mockResolvedValueOnce([ 
        [null, "{ invalid_json: "], 
        [null, null]
      ])
      .mockResolvedValueOnce([]); 

    mockPrismaTransaction.mockResolvedValue([{}]);

    await service.processBatch();

    expect(mockPrismaTransaction).toHaveBeenCalled();
  });

  test("should shutdown redis clients on shutdown", async () => {
    await service.shutdown();
    expect(mockRedisClient.quit).toHaveBeenCalledTimes(2);
  });
});