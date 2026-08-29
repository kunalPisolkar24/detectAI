import amqp, { type Channel, type ConsumeMessage, type ChannelModel } from "amqplib";
import { Logger } from "../logging/Logger";
import { MetricsService } from "../monitoring/MetricsService";
import { trace, SpanStatusCode } from "@opentelemetry/api";

type MessageHandler = (msg: any) => Promise<void>;

export class RabbitMQWorker {
    private connection: ChannelModel | null = null;
    private channel: Channel | null = null;
    private isConnected = false;
    private isConnecting = false;
    private isShuttingDown = false;

    constructor(
        private readonly queueUrl: string,
        private readonly queueName: string,
        private readonly handler: MessageHandler,
        private readonly metrics: MetricsService,
        private readonly queueType: "classic" | "quorum" = "classic",
        private readonly allowedJobTypes?: readonly string[]
    ) { }

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
            try {
                attempt++;
                const connection = await amqp.connect(this.queueUrl);

                connection.on("error", (err) => {
                    Logger.error("RabbitMQ connection error", err);
                });

                connection.on("close", () => {
                    if (this.isShuttingDown) return;
                    Logger.warn("RabbitMQ connection closed, reconnecting...");
                    this.handleDisconnect();
                });

                const channel = await connection.createChannel();

                channel.on("error", (err) => {
                    Logger.error("RabbitMQ channel error", err);
                });

                channel.on("close", () => {
                    Logger.warn("RabbitMQ channel closed");
                });

                this.connection = connection;
                this.channel = channel;

                await this.setupTopology();

                this.isConnected = true;
                this.isConnecting = false;
                this.metrics.rabbitmqConnectionStatus.set(1);
                Logger.info("Connected to RabbitMQ and topology initialized", { queue: this.queueName, type: this.queueType });
                break;
            } catch (e) {
                this.isConnected = false;
                this.metrics.rabbitmqConnectionStatus.set(0);
                if (this.isShuttingDown) break;
                const backoff = Math.min(Math.pow(2, attempt) * 1000, maxBackoff);
                Logger.warn("Failed to connect to RabbitMQ, retrying...", { attempt, nextRetryIn: `${backoff}ms`, error: e });
                await new Promise((r) => setTimeout(r, backoff));
            }
        }

        this.isConnecting = false;
    }

    private handleDisconnect() {
        this.isConnected = false;
        this.metrics.rabbitmqConnectionStatus.set(0);
        this.metrics.rabbitmqReconnections.inc();
        this.connection = null;
        this.channel = null;
        void this.connect();
    }

    private async setupTopology(): Promise<void> {
        if (!this.channel) return;

        const dlxName = `${this.queueName}_dlx`;
        const dlqName = `${this.queueName}_dlq`;

        await this.channel.assertExchange(dlxName, "direct", { durable: true });
        await this.channel.assertQueue(dlqName, { durable: true });
        await this.channel.bindQueue(dlqName, dlxName, this.queueName);

        const args: Record<string, unknown> = {
            "x-dead-letter-exchange": dlxName,
            "x-dead-letter-routing-key": this.queueName
        };

        if (this.queueType === "quorum") {
            args["x-queue-type"] = "quorum";
        }

        await this.channel.assertQueue(this.queueName, {
            durable: true,
            arguments: args
        });

        await this.channel.prefetch(1);
        await this.channel.consume(this.queueName, this.onMessage.bind(this));
    }

    private resolveJobType(event: any): string {
        const raw =
            typeof event?.event_type === "string"
                ? event.event_type
                : typeof event?.type === "string"
                    ? event.type
                    : "";
        if (!this.allowedJobTypes || !raw || !this.allowedJobTypes.includes(raw)) {
            return "other";
        }
        return raw;
    }

    private async onMessage(msg: ConsumeMessage | null) {
        if (!msg || !this.channel) return;

        let jobType: string = "other";
        const tracer = trace.getTracer("worker-messaging");
        const span = tracer.startSpan(`queue.consume ${this.queueName}`, { attributes: { "messaging.system": "rabbitmq", "messaging.destination": this.queueName } });
        try {
            const content = msg.content.toString();
            const event = JSON.parse(content);
            jobType = this.resolveJobType(event);
            span.setAttribute("job_type", jobType);

            this.metrics.messageSizeBytes.observe({ job_type: jobType }, msg.content.length);

            await this.handler(event);
            span.setStatus({ code: SpanStatusCode.OK });

            this.safeAck(msg);
        } catch (error) {
            try { span.recordException(error as Error); span.setStatus({ code: SpanStatusCode.ERROR }); } catch {}
            Logger.error("Failed to process message, sending to DLQ", error);
            this.metrics.deadLetteredTotal.inc({ job_type: jobType });
            this.safeNack(msg);
        } finally {
            try { span.end(); } catch {}
        }
    }

    private safeAck(msg: ConsumeMessage): void {
        try {
            if (!this.channel) {
                Logger.warn("Cannot acknowledge message, channel unavailable; broker will redeliver", { queue: this.queueName });
                return;
            }
            this.channel.ack(msg);
        } catch (error) {
            Logger.error("Failed to acknowledge message; broker will redeliver", error, { queue: this.queueName });
        }
    }

    private safeNack(msg: ConsumeMessage): void {
        try {
            if (!this.channel) {
                Logger.warn("Cannot reject message, channel unavailable; broker will redeliver", { queue: this.queueName });
                return;
            }
            this.channel.nack(msg, false, false);
        } catch (error) {
            Logger.error("Failed to reject message; broker will redeliver", error, { queue: this.queueName });
        }
    }

    public async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        this.isConnected = false;

        try {
            if (this.channel) await this.channel.close();
        } catch (e) {
            Logger.warn("Channel already closed during shutdown", e);
        }

        try {
            if (this.connection) await this.connection.close();
        } catch (e) {
            Logger.warn("Connection already closed during shutdown", e);
        }

        this.channel = null;
        this.connection = null;
    }
}
