import amqp, { type Connection, type Channel, type ConsumeMessage } from "amqplib";
import { Logger } from "../utils/logger";

type MessageHandler = (msg: any) => Promise<void>;

export class RabbitMQWorker {
    private connection: Connection | null = null;
    private channel: Channel | null = null;
    private isConnected = false;

    constructor(
        private readonly queueUrl: string,
        private readonly queueName: string,
        private readonly handler: MessageHandler
    ) { }

    public async start(): Promise<void> {
        await this.connectWithRetry();

        if (!this.connection || !this.channel) {
            process.exit(1);
        }

        this.connection.on("close", () => {
            Logger.error("RabbitMQ connection closed");
            this.isConnected = false;
            process.exit(1);
        });

        await this.channel.assertQueue(this.queueName, { 
            durable: true,
            arguments: {
                "x-dead-letter-exchange": `${this.queueName}_dlx`,
                "x-dead-letter-routing-key": this.queueName
            }
        });
        
        this.channel.prefetch(1);

        Logger.info("Worker started and waiting for messages", { queue: this.queueName });
        this.channel.consume(this.queueName, this.onMessage.bind(this));
    }

    public getStatus(): boolean {
        return this.isConnected;
    }

    private async connectWithRetry(retries = 15): Promise<void> {
        for (let i = 0; i < retries; i++) {
            try {
                const connection = await amqp.connect(this.queueUrl);
                const channel = await connection.createChannel();

                this.connection = connection as unknown as Connection;
                this.channel = channel as unknown as Channel;
                this.isConnected = true;
                Logger.info("Connected to RabbitMQ");
                break;
            } catch (e) {
                Logger.warn("Failed to connect to RabbitMQ, retrying...", { attempt: i + 1 });
                await new Promise((r) => setTimeout(r, 3000));
            }
        }
    }

    private async onMessage(msg: ConsumeMessage | null) {
        if (!msg || !this.channel) return;

        try {
            const content = msg.content.toString();
            const event = JSON.parse(content);
            
            await this.handler(event);
            
            this.channel.ack(msg);
            Logger.info("Message processed successfully", { type: event.event_type });
        } catch (error) {
            Logger.error("Failed to process message, sending to DLQ", error);
            this.channel.nack(msg, false, false);
        }
    }
}