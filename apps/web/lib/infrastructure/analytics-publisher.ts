import amqp from "amqplib"
import { env } from "@/lib/config/env"

const QUEUE = "analytics.usage"

class AnalyticsPublisher {
  private channel: amqp.Channel | null = null
  private connection: amqp.Connection | null = null
  private connecting: Promise<void> | null = null

  private async ensureChannel(): Promise<amqp.Channel> {
    if (this.channel) return this.channel
    if (this.connecting) await this.connecting
    if (this.channel) return this.channel

    this.connecting = this.connect()
    try {
      await this.connecting
      return this.channel!
    } finally {
      this.connecting = null
    }
  }

  private async connect(): Promise<void> {
    const conn = await amqp.connect(env.RABBITMQ_URL)

    conn.on("error", (err) => console.error("AnalyticsPublisher connection error", err))
    conn.on("close", () => {
      this.channel = null
      this.connection = null
    })

    const ch = await conn.createChannel()
    ch.on("error", (err) => console.error("AnalyticsPublisher channel error", err))
    ch.on("close", () => {
      this.channel = null
    })

    await ch.assertQueue(QUEUE, { durable: true })

    this.connection = conn
    this.channel = ch
  }

  async publish(userId: string, count: number): Promise<void> {
    const payload = Buffer.from(JSON.stringify({ userId, count, timestamp: new Date().toISOString() }))
    const opts = { persistent: true }

    let ch = await this.ensureChannel()
    try {
      ch.sendToQueue(QUEUE, payload, opts)
    } catch {
      this.channel = null
      this.connection = null
      this.connecting = null
      try {
        ch = await this.ensureChannel()
        ch.sendToQueue(QUEUE, payload, opts)
      } catch (retryErr) {
        console.error("AnalyticsPublisher retry failed, dropping message", retryErr)
      }
    }
  }
}

export const analyticsPublisher = new AnalyticsPublisher()
