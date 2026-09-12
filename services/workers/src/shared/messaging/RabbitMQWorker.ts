import amqp, { type Channel, type ConsumeMessage, type ChannelModel } from "amqplib";
import { Logger } from "../logging/Logger";
import { MetricsService } from "../monitoring/MetricsService";
import { trace, SpanStatusCode, propagation, context } from "@opentelemetry/api";
import { isRetryableError as defaultIsRetryable } from "../errors/isRetryableError";
import { simpleBackoffWithJitter } from "../retry/backoff";
import { abortableSleep } from "../utils/abortableSleep";
import { dlxName, dlqName, retryExchangeName, retryQueueName, RETRY_TTL_MS, MAX_RETRIES } from "./topology";

type MessageHandler = (msg: any) => Promise<void>;

export class RabbitMQWorker {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private isConnected = false;
  private isConnecting = false;
  private isShuttingDown = false;
  private consumerTag: string | null = null;
  private inflight = 0;
  private abortController = new AbortController();
  private readonly prefetch: number;
  private readonly infraRequeueDelayMs: number;
  private readonly isInfraHealthy: () => Promise<boolean>;
  private readonly isRetryable: (error: unknown) => boolean;

  constructor(
    private readonly queueUrl: string,
    private readonly queueName: string,
    private readonly handler: MessageHandler,
    private readonly metrics: MetricsService,
    private readonly allowedJobTypes?: readonly string[],
    opts?: {
      prefetch?: number;
      infraRequeueDelayMs?: number;
      isInfraHealthy?: () => Promise<boolean>;
      isRetryable?: (error: unknown) => boolean;
    }
  ) {
    this.prefetch = opts?.prefetch ?? 1;
    this.infraRequeueDelayMs = opts?.infraRequeueDelayMs ?? 5000;
    this.isInfraHealthy = opts?.isInfraHealthy ?? (async () => true);
    this.isRetryable = opts?.isRetryable ?? defaultIsRetryable;
  }

  public async start(): Promise<void> {
    await this.connect();
  }

  public getStatus(): boolean {
    return this.isConnected && !this.isShuttingDown;
  }

  private async connect(): Promise<void> {
    if (this.isConnecting || this.isShuttingDown) return;
    this.isConnecting = true;
    let attempt = 0;
    const maxBackoff = 30000;
    while (!this.isShuttingDown) {
      let localConnection: ChannelModel | null = null;
      let localChannel: Channel | null = null;
      try {
        attempt++;
        localConnection = await amqp.connect(this.queueUrl);
        localConnection.on("error", (err) => {
          Logger.error("RabbitMQ connection error", err);
          if (!this.isShuttingDown) {
            this.isConnected = false;
            this.metrics.rabbitmqConnectionStatus.set(0);
            this.handleDisconnect();
          }
        });
        localConnection.on("close", () => {
          if (this.isShuttingDown) return;
          Logger.warn("RabbitMQ connection closed, reconnecting...");
          this.handleDisconnect();
        });
        localChannel = await localConnection.createChannel();
        localChannel.on("error", (err) => {
          Logger.error("RabbitMQ channel error", err);
          if (!this.isShuttingDown) {
            this.isConnected = false;
            this.metrics.rabbitmqConnectionStatus.set(0);
            this.handleDisconnect();
          }
        });
        localChannel.on("close", () => {
          Logger.warn("RabbitMQ channel closed");
          if (!this.isShuttingDown) {
            this.isConnected = false;
            this.metrics.rabbitmqConnectionStatus.set(0);
          }
        });
        this.connection = localConnection;
        this.channel = localChannel;
        localConnection = null;
        localChannel = null;
        await this.setupTopology();
        this.isConnected = true;
        this.isConnecting = false;
        this.metrics.rabbitmqConnectionStatus.set(1);
        Logger.info("Connected to RabbitMQ and topology initialized", { queue: this.queueName, type: "quorum" });
        break;
      } catch (e) {
        try {
          if (localChannel) await localChannel.close();
        } catch {}
        try {
          if (localConnection) await localConnection.close();
        } catch {}
        if (this.channel && localChannel === null) {
          try {
            await this.channel.close();
          } catch {}
          this.channel = null;
        }
        if (this.connection && localConnection === null) {
          try {
            await this.connection.close();
          } catch {}
          this.connection = null;
        }
        this.isConnected = false;
        this.metrics.rabbitmqConnectionStatus.set(0);
        if (this.isShuttingDown) break;
        const backoff = simpleBackoffWithJitter(attempt, maxBackoff);
        Logger.warn("Failed to connect to RabbitMQ, retrying...", { attempt, nextRetryIn: `${Math.round(backoff)}ms`, error: e });
        await abortableSleep(backoff, this.abortController.signal);
      }
    }
    this.isConnecting = false;
  }

  private handleDisconnect() {
    if (this.isConnecting || this.isShuttingDown) return;
    this.isConnected = false;
    this.metrics.rabbitmqConnectionStatus.set(0);
    try {
      this.metrics.rabbitmqReconnections.inc();
    } catch {}
    this.connection = null;
    this.channel = null;
    this.consumerTag = null;
    void this.connect().catch((e) => Logger.error("Reconnect failed", e as any));
  }

  private async setupTopology(): Promise<void> {
    if (!this.channel) return;
    const dlx = dlxName(this.queueName);
    const dlq = dlqName(this.queueName);
    const retryExchange = retryExchangeName(this.queueName);
    const retryQueue = retryQueueName(this.queueName);

    await this.channel.assertExchange(dlx, "direct", { durable: true });
    await this.channel.assertQueue(dlq, { durable: true, arguments: { "x-queue-type": "quorum" } });
    await this.channel.bindQueue(dlq, dlx, this.queueName);

    await this.channel.assertExchange(retryExchange, "direct", { durable: true });
    const retryArgs: Record<string, unknown> = {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": this.queueName,
      "x-message-ttl": RETRY_TTL_MS,
      "x-queue-type": "quorum",
    };
    try {
      await this.channel.assertQueue(retryQueue, { durable: true, arguments: retryArgs });
      await this.channel.bindQueue(retryQueue, retryExchange, retryQueue);
    } catch (error: any) {
      const msg = String(error?.message ?? error);
      if (msg.includes("PRECONDITION_FAILED") || msg.includes("406")) {
        Logger.error("Queue declare failed (406). Quorum mismatch or TTL changed. Delete old queue or version queue.", { queue: retryQueue, error });
      }
      throw error;
    }

    const args: Record<string, unknown> = {
      "x-dead-letter-exchange": dlx,
      "x-dead-letter-routing-key": this.queueName,
      "x-queue-type": "quorum",
    };

    try {
      await this.channel.assertQueue(this.queueName, { durable: true, arguments: args });
    } catch (error: any) {
      const msg = String(error?.message ?? error);
      if (msg.includes("PRECONDITION_FAILED") || msg.includes("406")) {
        Logger.error("Queue declare failed (406). Quorum mismatch. Delete old queue or version queue.", { queue: this.queueName, error });
      }
      throw error;
    }

    await this.channel.prefetch(this.prefetch);
    const consumeOk = await this.channel.consume(this.queueName, this.onMessage.bind(this));
    this.consumerTag = (consumeOk as any)?.consumerTag ?? null;
  }

  private resolveJobType(event: any): string {
    const raw = typeof event?.event_type === "string" ? event.event_type : typeof event?.type === "string" ? event.type : "";
    if (!this.allowedJobTypes || !raw || !this.allowedJobTypes.includes(raw)) return "other";
    return raw;
  }

  private getRetryCount(msg: ConsumeMessage): number {
    try {
      const headers: any = (msg.properties && (msg.properties as any).headers) || {};
      if (typeof headers["x-retry-count"] === "number") return headers["x-retry-count"];
      const xDeath = headers["x-death"];
      if (Array.isArray(xDeath) && xDeath.length > 0) {
        let total = 0;
        for (const entry of xDeath) {
          if (entry.queue === `${this.queueName}_retry` || entry.exchange === `${this.queueName}_retry_exchange`) {
            total += typeof entry.count === "number" ? entry.count : 1;
          }
        }
        if (total > 0) return total;
        return 0;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  private async onMessage(msg: ConsumeMessage | null) {
    const deliveryChannel = this.channel;
    if (!msg || !deliveryChannel) return;
    this.inflight++;
    let jobType: string = "other";
    const tracer = trace.getTracer("worker-messaging");
    let parentContext = context.active();
    try {
      const headers = (msg.properties as any)?.headers as Record<string, unknown> | undefined;
      if (headers && typeof headers["traceparent"] === "string") {
        parentContext = propagation.extract(parentContext, headers as any);
      }
    } catch {}
    const span = tracer.startSpan(`queue.consume ${this.queueName}`, { attributes: { "messaging.system": "rabbitmq", "messaging.destination": this.queueName } }, parentContext);
    try {
      const content = msg.content.toString();
      let event: any;
      try {
        event = JSON.parse(content);
      } catch (parseError) {
        Logger.error("Invalid JSON, sending to DLQ", parseError as any, { queue: this.queueName });
        try {
          this.metrics.deadLetteredTotal.inc({ job_type: "invalid_json" });
        } catch {}
        this.safeNack(msg, deliveryChannel);
        try {
          span.recordException(parseError as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
        } catch {}
        return;
      }
      jobType = this.resolveJobType(event);
      span.setAttribute("job_type", jobType);
      try {
        this.metrics.messageSizeBytes.observe({ job_type: jobType }, msg.content.length);
      } catch {}
      await context.with(trace.setSpan(parentContext, span), async () => {
        await this.handler(event);
      });
      span.setStatus({ code: SpanStatusCode.OK });
      this.safeAck(msg, deliveryChannel);
    } catch (error) {
      try {
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR });
      } catch {}
      let dbOk = true;
      try {
        dbOk = await this.isInfraHealthy();
      } catch {
        dbOk = false;
      }
      if (!dbOk) {
        try {
          (this.metrics as any).infraRequeuedTotal?.inc({ job_type: jobType, dep: "postgres" });
        } catch {}
        Logger.warn("Postgres unavailable, requeueing message (no retry burn, no DLQ)", { jobType, queue: this.queueName, error });
        await abortableSleep(this.infraRequeueDelayMs, this.abortController.signal);
        if (this.isShuttingDown) return;
        this.safeNack(msg, deliveryChannel, true);
        return;
      }
      const retryable = this.isRetryable(error);
      const retryCount = this.getRetryCount(msg);
      if (retryable && retryCount < MAX_RETRIES) {
        Logger.warn("Transient failure, retrying via delayed exchange", { jobType, retryCount, maxRetries: MAX_RETRIES, error });
        try {
          (this.metrics as any).workerRetryTotal?.inc({ job_type: jobType });
        } catch {}
        const retryExchange = retryExchangeName(this.queueName);
        const retryQueue = retryQueueName(this.queueName);
        try {
          const headers = { ...((msg.properties as any)?.headers || {}), "x-retry-count": retryCount + 1 };
          const ok = deliveryChannel.publish(retryExchange, retryQueue, msg.content, {
            persistent: true,
            contentType: "application/json",
            headers,
          });
          if (ok === false) {
            Logger.warn("Publish buffer full, nacking with requeue", { queue: this.queueName });
            this.safeNack(msg, deliveryChannel, true);
            return;
          }
          this.safeAck(msg, deliveryChannel);
          return;
        } catch (publishError) {
          Logger.error("Failed to publish to retry exchange, sending to DLQ", publishError as any);
        }
      }
      Logger.error("Failed to process message, sending to DLQ", error as any);
      try {
        this.metrics.deadLetteredTotal.inc({ job_type: jobType });
      } catch {}
      this.safeNack(msg, deliveryChannel);
    } finally {
      this.inflight--;
      try {
        span.end();
      } catch {}
    }
  }

  private safeAck(msg: ConsumeMessage, channel: Channel | null): void {
    try {
      const ch = channel ?? this.channel;
      if (!ch) {
        Logger.warn("Cannot acknowledge message, channel unavailable; broker will redeliver", { queue: this.queueName });
        return;
      }
      ch.ack(msg);
    } catch (error) {
      Logger.error("Failed to acknowledge message; broker will redeliver", error as any, { queue: this.queueName });
    }
  }

  private safeNack(msg: ConsumeMessage, channel: Channel | null, requeue = false): void {
    try {
      const ch = channel ?? this.channel;
      if (!ch) {
        Logger.warn("Cannot reject message, channel unavailable; broker will redeliver", { queue: this.queueName });
        return;
      }
      ch.nack(msg, false, requeue);
    } catch (error) {
      Logger.error("Failed to reject message; broker will redeliver", error as any, { queue: this.queueName });
    }
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.isConnected = false;
    this.abortController.abort();
    try {
      if (this.channel && this.consumerTag) await this.channel.cancel(this.consumerTag);
    } catch (e: any) {
      Logger.warn("Failed to cancel consumer during shutdown", { error: e instanceof Error ? e.message : String(e) });
    }
    const drainStart = Date.now();
    const drainTimeout = 10000;
    while (this.inflight > 0 && Date.now() - drainStart < drainTimeout) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (this.inflight > 0) Logger.warn("Shutdown drained timeout with inflight messages", { inflight: this.inflight });
    try {
      if (this.channel) await this.channel.close();
    } catch (e: any) {
      Logger.warn("Channel already closed during shutdown", { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      if (this.connection) await this.connection.close();
    } catch (e: any) {
      Logger.warn("Connection already closed during shutdown", { error: e instanceof Error ? e.message : String(e) });
    }
    this.channel = null;
    this.connection = null;
    this.consumerTag = null;
  }
}
