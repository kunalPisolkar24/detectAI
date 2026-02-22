import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { prismaMock, mockUserUpdate, mockUserUpdateMany, mockUserFindUnique } from "../../mocks/db";

const mockRedisClient = {
  del: mock(() => Promise.resolve(0)),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
};

const mockRelease = mock(() => Promise.resolve());
const mockAcquire = mock(() => Promise.resolve(mockRelease));
const mockLogger = { info: mock(), error: mock(), warn: mock() };

mock.module("@shared/db", () => prismaMock);

mock.module("@shared/redis", () => ({
  RedisFactory: {
    createClient: mock(() => mockRedisClient),
  },
}));

mock.module("@shared/cache/lock", () => ({
  LockService: class {
    acquire = mockAcquire;
  }
}));

mock.module("@shared/logger", () => ({
  Logger: mockLogger
}));

mock.module("../../../config", () => ({
  config: {
    PADDLE_API_KEY: "test_key",
    PADDLE_ENVIRONMENT: "sandbox",
  }
}));

const originalFetch = global.fetch;
const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }))));

const createMetricsMock = () => ({
  jobDuration: { startTimer: mock(() => mock()) },
  jobTotal: { inc: mock() },
  jobErrors: { inc: mock() },
  cacheOperations: { inc: mock() },
});

const { PaymentService } = await import("../../../services/PaymentService");
const { CacheKeys } = await import("@shared/cache/keys");

describe("PaymentService", () => {
  let service: InstanceType<typeof PaymentService>;
  let metricsMock: ReturnType<typeof createMetricsMock>;

  beforeEach(() => {
    mockUserUpdate.mockClear();
    mockUserUpdateMany.mockClear();
    mockUserFindUnique.mockClear();
    mockRedisClient.del.mockClear();
    mockAcquire.mockClear();
    mockRelease.mockClear();
    mockLogger.error.mockClear();
    mockFetch.mockClear();

    mockUserUpdate.mockResolvedValue({});
    mockUserUpdateMany.mockResolvedValue({ count: 1 });
    mockUserFindUnique.mockResolvedValue({ email: "test@example.com" });
    mockRedisClient.del.mockResolvedValue(0);
    mockAcquire.mockResolvedValue(mockRelease);

    global.fetch = mockFetch as unknown as typeof fetch;
    metricsMock = createMetricsMock();

    service = new PaymentService(
      mockRedisClient as any,
      { acquire: mockAcquire } as any,
      metricsMock as any
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("subscription.created: updates user, locks resources, invalidates cache", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        status: "active",
        items: [{ price: { id: "plan_1" } }],
        custom_data: { userId: "user_1" },
        current_billing_period: { ends_at: "2025-01-01" }
      }
    };

    mockUserUpdate.mockResolvedValue({ email: "test@test.com" });

    await service.handleEvent(event as any);

    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user_1" },
      data: expect.objectContaining({ paddleSubscriptionId: "sub_1" })
    }));

    expect(mockAcquire).toHaveBeenCalledWith(CacheKeys.user("user_1"));
    expect(mockAcquire).toHaveBeenCalledWith(CacheKeys.userByEmail("test@test.com"));
    expect(mockRedisClient.del).toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(2);
  });

  test("subscription.updated: updates user subscription data", async () => {
    const event = {
      event_type: "subscription.updated",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        status: "active",
        items: [{ price: { id: "plan_updated" } }],
        custom_data: { userId: "user_1" },
        scheduled_change: { effective_at: "2025-06-01", action: "cancel" }
      }
    };

    mockUserUpdate.mockResolvedValue({ email: "test@test.com" });

    await service.handleEvent(event as any);

    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user_1" },
      data: expect.objectContaining({
        paddlePlanId: "plan_updated",
        paddleCancellationScheduled: true
      })
    }));
  });

  test("subscription.canceled: updates user and invalidates cache", async () => {
    const event = {
      event_type: "subscription.canceled",
      data: {
        id: "sub_1",
        custom_data: { userId: "user_1" },
        canceled_at: "2025-01-01"
      }
    };

    mockUserFindUnique.mockResolvedValue({ email: "test@test.com" });
    mockUserUpdateMany.mockResolvedValue({ count: 1 });

    await service.handleEvent(event as any);

    expect(mockUserUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user_1", paddleSubscriptionId: "sub_1" },
      data: expect.objectContaining({ paddleSubscriptionStatus: "CANCELED" })
    }));

    expect(mockRedisClient.del).toHaveBeenCalled();
  });

  test("subscription.canceled: skips if user not found", async () => {
    const event = {
      event_type: "subscription.canceled",
      data: {
        id: "sub_1",
        custom_data: { userId: "unknown_user" }
      }
    };

    mockUserFindUnique.mockResolvedValue(null);

    await service.handleEvent(event as any);

    expect(mockUserUpdateMany).not.toHaveBeenCalled();
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  test("subscription.canceled: skips if no subscription id", async () => {
    const event = {
      event_type: "subscription.canceled",
      data: {
        custom_data: { userId: "user_1" }
      }
    };

    await service.handleEvent(event as any);

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserUpdateMany).not.toHaveBeenCalled();
  });

  test("user.cancel_subscription: calls Paddle API", async () => {
    const event = {
      event_type: "user.cancel_subscription",
      data: {
        paddleSubscriptionId: "sub_to_cancel"
      }
    };

    await service.handleEvent(event as any);

    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = (mockFetch as any).mock.calls[0];
    if (fetchCall && fetchCall[0]) {
      expect(String(fetchCall[0])).toContain("/subscriptions/sub_to_cancel/cancel");
    }
  });


  test("user.cancel_subscription: throws if missing subscription id", async () => {
    const event = {
      event_type: "user.cancel_subscription",
      data: {}
    };

    await expect(service.handleEvent(event as any)).rejects.toThrow("Missing subscription ID");
  });

  test("user.cancel_subscription: throws on Paddle API error", async () => {
    const event = {
      event_type: "user.cancel_subscription",
      data: {
        paddleSubscriptionId: "sub_fail"
      }
    };

    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: "failed" }), { status: 400 }));

    await expect(service.handleEvent(event as any)).rejects.toThrow("Paddle API Error");
  });

  test("ignores events without userId", async () => {
    const event = {
      event_type: "subscription.updated",
      data: { id: "sub_1" }
    };

    await service.handleEvent(event as any);

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockAcquire).not.toHaveBeenCalled();
  });

  test("ignores subscription.created without required data", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        custom_data: { userId: "user_1" }
      }
    };

    await service.handleEvent(event as any);

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  test("handles lock acquisition failure by attempting forced delete", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        custom_data: { userId: "user_1" },
        id: "sub_1",
        customer_id: "c",
        status: "active",
        items: [{ price: { id: "p" } }]
      }
    };

    mockUserUpdate.mockResolvedValue({ email: "test@test.com" });
    mockAcquire.mockRejectedValue(new Error("Lock Error"));

    await service.handleEvent(event as any);

    expect(mockRedisClient.del).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith("Failed to invalidate cache with locks", expect.any(Error), expect.anything());
  });

  test("handles lock acquisition failure AND fallback delete failure", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        custom_data: { userId: "user_1" },
        id: "sub_1",
        customer_id: "c",
        status: "active",
        items: [{ price: { id: "p" } }]
      }
    };

    mockUserUpdate.mockResolvedValue({ email: "test@test.com" });
    mockAcquire.mockRejectedValue(new Error("Lock Error"));
    mockRedisClient.del.mockRejectedValue(new Error("Redis Delete Error"));

    await service.handleEvent(event as any);

    expect(mockLogger.error).toHaveBeenCalledWith("Fallback delete failed", expect.any(Error));
  });

  test("handles db update failure", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        status: "active",
        items: [{ price: { id: "plan_1" } }],
        custom_data: { userId: "user_1" }
      }
    };

    mockUserUpdate.mockRejectedValue(new Error("DB Error"));

    await expect(service.handleEvent(event as any)).rejects.toThrow("DB Error");
  });

  test("parses trialing status correctly", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        status: "trialing",
        items: [{ price: { id: "plan_1" } }],
        custom_data: { userId: "user_1" }
      }
    };

    mockUserUpdate.mockResolvedValue({ email: "test@test.com" });

    await service.handleEvent(event as any);

    expect(mockUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paddleSubscriptionStatus: "TRIALING" })
    }));
  });

  test("handles unknown status gracefully", async () => {
    const event = {
      event_type: "subscription.created",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        status: "unknown_status",
        items: [{ price: { id: "plan_1" } }],
        custom_data: { userId: "user_1" }
      }
    };

    await service.handleEvent(event as any);

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});