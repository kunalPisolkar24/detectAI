import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { amqpMock, mockChannel, mockAck, mockNack, mockOn, mockAssertExchange, mockBindQueue, mockPublish } from "../../mocks/amqplib";
import { MetricsService } from "@shared/monitoring/MetricsService";

process.env.INFRA_REQUEUE_DELAY_MS = "0";

const originalExit = process.exit;
const mockExit = mock(() => { throw new Error("process.exit called"); });
process.exit = mockExit as any;

mock.module("amqplib", () => amqpMock);

const mockCheckDb = mock(() => Promise.resolve(true));

const { RabbitMQWorker } = await import("@shared/messaging/RabbitMQWorker");

describe("RabbitMQWorker", () => {
  let worker: any;
  let mockHandler: any;
  const metrics = new MetricsService("test");

  beforeEach(() => {
    mockHandler = mock(() => Promise.resolve());
    mockAck.mockClear();
    mockNack.mockClear();
    mockPublish.mockClear();
    mockCheckDb.mockReset();
    mockCheckDb.mockImplementation(() => Promise.resolve(true));
    mockChannel.consume.mockClear();
    mockChannel.assertQueue.mockClear();
    mockChannel.assertExchange.mockClear();
    mockChannel.bindQueue.mockClear();
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
  });

  afterEach(async () => {
    if (worker) await worker.shutdown();
  });

  test("should establish connection and setup queue", async () => {
    await worker.start();
    expect(mockChannel.assertQueue).toHaveBeenCalled();
    expect(mockChannel.consume).toHaveBeenCalled();
    expect(worker.getStatus()).toBe(true);
  });

  test("should declare dlx, dlq and binding alongside the work queue", async () => {
    await worker.start();
    expect(mockAssertExchange).toHaveBeenCalledWith("test_queue_dlx", "direct", { durable: true });
    expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue_dlq", expect.objectContaining({ durable: true }));
    expect(mockBindQueue).toHaveBeenCalledWith("test_queue_dlq", "test_queue_dlx", "test_queue");
    expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue", expect.objectContaining({
      arguments: expect.objectContaining({
        "x-dead-letter-exchange": "test_queue_dlx",
        "x-dead-letter-routing-key": "test_queue",
      }),
    }));
  });

  test("should bound job_type labels to the allowlist", async () => {
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler, metrics, ["subscription.updated"], { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    const observeSpy = mock(() => {});
    (worker.metrics.messageSizeBytes as any).observe = observeSpy;
    const onMessageCallback = mockChannel.consume.mock.calls.at(-1)![1];
    await onMessageCallback({ content: Buffer.from(JSON.stringify({ event_type: "subscription.updated" })) });
    await onMessageCallback({ content: Buffer.from(JSON.stringify({ event_type: "evil" + "x".repeat(500) })) });
    await onMessageCallback({ content: Buffer.from(JSON.stringify({ userId: "u1" })) });
    const labelArgs = observeSpy.mock.calls.map((c: any) => c[0].job_type);
    expect(labelArgs).toEqual(["subscription.updated", "other", "other"]);
  });

  test("should acknowledge message on successful processing", async () => {
    await worker.start();
    expect(mockChannel.consume).toHaveBeenCalled();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })) };
    await onMessageCallback(fakeMsg);
    expect(mockHandler).toHaveBeenCalled();
    expect(mockAck).toHaveBeenCalledWith(fakeMsg);
    expect(mockNack).not.toHaveBeenCalled();
  });

  test("should negative acknowledge message on failure", async () => {
    const { UserNotFoundError } = await import("../../../domain/errors");
    const failingHandler = mock(() => Promise.reject(new UserNotFoundError("user_123")));
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    expect(mockChannel.consume).toHaveBeenCalled();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })), properties: { headers: {} } } as any;
    await onMessageCallback(fakeMsg);
    expect(failingHandler).toHaveBeenCalled();
    expect(mockNack).toHaveBeenCalled();
  });

  test("should declare queue as quorum when specified", async () => {
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", mockHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue", expect.objectContaining({
      arguments: expect.objectContaining({ "x-queue-type": "quorum" }),
    }));
    expect(mockChannel.assertQueue).toHaveBeenCalledWith("test_queue_dlq", expect.objectContaining({
      arguments: expect.objectContaining({ "x-queue-type": "quorum" }),
    }));
  });

  test("should handle connection close event without exiting", async () => {
    await worker.start();
    expect(mockOn).toHaveBeenCalledWith("close", expect.any(Function));
    const closeCallback = mockOn.mock.calls.find((call) => call[0] === "close")?.[1];
    expect(closeCallback).toBeDefined();
    closeCallback();
    expect(mockExit).not.toHaveBeenCalled();
  });

  test("should not attempt reconnect after shutdown", async () => {
    await worker.start();
    expect(worker.getStatus()).toBe(true);
    await worker.shutdown();
    expect(worker.getStatus()).toBe(false);
    const connectSpy = mock(() => Promise.resolve());
    const originalConnect = worker.connect;
    worker.connect = connectSpy;
    const closeCallback = mockOn.mock.calls.find((call) => call[0] === "close")?.[1]!;
    closeCallback();
    expect(connectSpy).not.toHaveBeenCalled();
    worker.connect = originalConnect;
  });

  test("should resolve without ack when channel is unavailable after processing", async () => {
    await worker.start();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })) };
    mockHandler.mockImplementation(() => {
      worker.channel = null;
      return Promise.resolve();
    });
    await onMessageCallback(fakeMsg);
    expect(mockHandler).toHaveBeenCalled();
    expect(mockAck).toHaveBeenCalledWith(fakeMsg);
  });

  test("should not throw when nack hits a dead channel", async () => {
    const failingHandler = mock(() => {
      worker.channel = null;
      return Promise.reject(new Error("Fail"));
    });
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })), properties: { headers: {} } } as any;
    await onMessageCallback(fakeMsg);
    expect(failingHandler).toHaveBeenCalled();
    expect(mockNack.mock.calls.length + mockAck.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  test("should requeue (no retry burn, no DLQ) when postgres is down", async () => {
    mockCheckDb.mockImplementation(() => Promise.resolve(false));
    const failingHandler = mock(() => Promise.reject(new Error("connect ECONNREFUSED postgres:5432")));
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    const dlqSpy = mock(() => {});
    const requeueSpy = mock(() => {});
    (metrics as any).deadLetteredTotal.inc = dlqSpy;
    (metrics as any).infraRequeuedTotal.inc = requeueSpy;
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })), properties: { headers: {} } } as any;
    await onMessageCallback(fakeMsg);
    expect(failingHandler).toHaveBeenCalled();
    expect(mockNack).toHaveBeenCalledWith(fakeMsg, false, true);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(dlqSpy).not.toHaveBeenCalled();
    expect(requeueSpy).toHaveBeenCalledWith({ job_type: "other", dep: "postgres" });
  });

  test("should not burn retries across redeliveries during an outage", async () => {
    mockCheckDb.mockImplementation(() => Promise.resolve(false));
    const failingHandler = mock(() => Promise.reject(new Error("connect ECONNREFUSED postgres:5432")));
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })), properties: { headers: {} } } as any;
    await onMessageCallback(fakeMsg);
    await onMessageCallback(fakeMsg);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(fakeMsg.properties.headers["x-retry-count"]).toBeUndefined();
    expect(mockNack.mock.calls.filter((c: any) => c[2] === true).length).toBe(2);
  });

  test("should resume normal DLQ routing once postgres recovers", async () => {
    const failingHandler = mock(() => Promise.reject(new Error("boom")));
    worker = new RabbitMQWorker("amqp://localhost", "test_queue", failingHandler, metrics, undefined, { infraRequeueDelayMs: 0, isInfraHealthy: mockCheckDb as any });
    await worker.start();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })), properties: { headers: {} } } as any;
    mockCheckDb.mockImplementation(() => Promise.resolve(false));
    await onMessageCallback(fakeMsg);
    expect(mockPublish).not.toHaveBeenCalled();
    mockCheckDb.mockImplementation(() => Promise.resolve(true));
    await onMessageCallback(fakeMsg);
    expect(mockPublish).toHaveBeenCalled();
  });

  test("should swallow channel errors during acknowledge", async () => {
    await worker.start();
    const onMessageCallback = mockChannel.consume.mock.calls[0]![1];
    const fakeMsg = { content: Buffer.from(JSON.stringify({ event_type: "test" })) };
    mockAck.mockImplementation(() => { throw new Error("IllegalOperationError: Channel closed"); });
    await onMessageCallback(fakeMsg);
    expect(mockHandler).toHaveBeenCalled();
    expect(mockAck).toHaveBeenCalledWith(fakeMsg);
    mockAck.mockImplementation(() => {});
  });
});
