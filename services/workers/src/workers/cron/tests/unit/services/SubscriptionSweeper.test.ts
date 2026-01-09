import { describe, test, expect, mock, beforeEach } from "bun:test";
import { prismaMock, mockFindMany, mockUpdateMany } from "../../mocks/db";
import { redisMock, mockDel } from "../../mocks/redis";
import { CacheKeys } from "@shared/cache/keys";

mock.module("@shared/db", () => prismaMock);
mock.module("@shared/redis", () => redisMock);

const mockLogger = {
  info: mock(),
  error: mock(),
  warn: mock(),
};

mock.module("@shared/logger", () => ({
  Logger: mockLogger
}));

const SubscriptionStatus = {
  ACTIVE: "ACTIVE",
  CANCELED: "CANCELED",
  PAST_DUE: "PAST_DUE",
  PAUSED: "PAUSED",
  TRIALING: "TRIALING"
};

mock.module("../../../../generated/prisma/client", () => ({
  SubscriptionStatus
}));

const { SubscriptionSweeper } = await import("../../../services/SubscriptionSweeper");

describe("SubscriptionSweeper", () => {
  let sweeper: InstanceType<typeof SubscriptionSweeper>;

  beforeEach(() => {
    sweeper = new SubscriptionSweeper();
    mockFindMany.mockClear();
    mockUpdateMany.mockClear();
    mockDel.mockClear();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
  });

  test("should return 0 when no expired subscriptions are found", async () => {
    (mockFindMany as any).mockResolvedValue([]);

    const result = await sweeper.processExpiredSubscriptions();

    expect(result).toBe(0);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
  });

  test("should downgrade users and invalidate cache when expired subscriptions are found", async () => {
    const expiredUsers = [
      { id: "user_1", email: "user1@example.com" },
      { id: "user_2", email: "user2@example.com" },
    ];

    (mockFindMany as any).mockResolvedValue(expiredUsers);
    (mockUpdateMany as any).mockResolvedValue({ count: 2 });
    (mockDel as any).mockResolvedValue(4);

    const result = await sweeper.processExpiredSubscriptions();

    expect(result).toBe(2);
    
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { paddleSubscriptionStatus: SubscriptionStatus.ACTIVE },
          { paddleSubscriptionStatus: SubscriptionStatus.TRIALING }
        ],
        subscriptionEndsAt: {
          lt: expect.any(Date),
        },
      },
      take: 100,
      select: {
        id: true,
        email: true,
      },
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["user_1", "user_2"] }
      },
      data: {
        paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
        paddleCancellationScheduled: false,
        paddleSubscriptionId: null,
        paddlePlanId: null,
      },
    });

    expect(mockDel).toHaveBeenCalledTimes(1);
    
    // Explicitly cast the call arguments to string[] to satisfy TS and verify existence
    const delCallArgs = mockDel.mock.calls[0] as string[];
    expect(delCallArgs).toBeDefined();
    expect(delCallArgs).toContain(CacheKeys.user("user_1"));
    expect(delCallArgs).toContain(CacheKeys.user("user_2"));
    expect(delCallArgs).toContain(CacheKeys.userByEmail("user1@example.com"));
    expect(delCallArgs).toContain(CacheKeys.userByEmail("user2@example.com"));
  });

  test("should throw error if database update fails", async () => {
    const expiredUsers = [{ id: "user_1", email: "user1@example.com" }];
    (mockFindMany as any).mockResolvedValue(expiredUsers);
    (mockUpdateMany as any).mockRejectedValue(new Error("DB Connection Failed"));

    expect(sweeper.processExpiredSubscriptions()).rejects.toThrow("DB Connection Failed");

    expect(mockUpdateMany).toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled(); 
    expect(mockLogger.error).toHaveBeenCalledWith("Failed to perform bulk sweep", expect.any(Error));
  });

  test("should catch and log error if cache invalidation fails but still return count", async () => {
    const expiredUsers = [{ id: "user_1", email: "user1@example.com" }];
    (mockFindMany as any).mockResolvedValue(expiredUsers);
    (mockUpdateMany as any).mockResolvedValue({ count: 1 });
    (mockDel as any).mockRejectedValue(new Error("Redis Down"));

    const result = await sweeper.processExpiredSubscriptions();

    expect(result).toBe(1);
    expect(mockUpdateMany).toHaveBeenCalled();
    expect(mockDel).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith("Failed to bulk invalidate cache", expect.any(Error));
  });
});