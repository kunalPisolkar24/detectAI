import amqp, { type Channel, type ConsumeMessage, type ChannelModel } from "amqplib";
import { Logger } from "@shared/logger";

type MessageHandler = (msg: any) => Promise<void>;

export class RabbitMQWorker {
    private connection: ChannelModel | null = null;
    private channel: Channel | null = null;
    private isConnected = false;
    private isConnecting = false;

    constructor(
        private readonly queueUrl: string,
        private readonly queueName: string,
        private readonly handler: MessageHandler,
        private readonly queueType: "classic" | "quorum" = "classic"
    ) { }

    public async start(): Promise<void> {
        await this.connect();
    }

    public getStatus(): boolean {
        return this.isConnected;
    }

    private async connect(): Promise<void> {
        if (this.isConnecting) return;
        this.isConnecting = true;

        let attempt = 0;
        const maxBackoff = 30000;
        
        while (true) {
            try {
                attempt++;
                const connection = await amqp.connect(this.queueUrl);
                
                connection.on("error", (err) => {
                    Logger.error("RabbitMQ connection error", err);
                });

                connection.on("close", () => {
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
                Logger.info("Connected to RabbitMQ and topology initialized", { queue: this.queueName, type: this.queueType });
                break;
            } catch (e) {
                this.isConnected = false;
                const backoff = Math.min(Math.pow(2, attempt) * 1000, maxBackoff);
                Logger.warn("Failed to connect to RabbitMQ, retrying...", { attempt, nextRetryIn: `${backoff}ms`, error: e });
                await new Promise((r) => setTimeout(r, backoff));
            }
        }
    }

    private handleDisconnect() {
        this.isConnected = false;
        this.connection = null;
        this.channel = null;
        this.connect();
    }

    private async setupTopology(): Promise<void> {
        if (!this.channel) return;

        const args: any = {
            "x-dead-letter-exchange": `${this.queueName}_dlx`,
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

    private async onMessage(msg: ConsumeMessage | null) {
        if (!msg || !this.channel) return;

        try {
            const content = msg.content.toString();
            const event = JSON.parse(content);
            
            await this.handler(event);
            
            this.channel.ack(msg);
        } catch (error) {
            Logger.error("Failed to process message, sending to DLQ", error);
            this.channel.nack(msg, false, false);
        }
    }
}