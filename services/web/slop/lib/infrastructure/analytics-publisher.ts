import amqp from "amqplib"
import { env } from "@/lib/config/env"
import { metrics } from "@/lib/infrastructure/metrics"
import { isPreviewMode } from "@/lib/config/preview"

// Queue: analytics.usage (quorum, durable, DLX analytics.usage_dlx). Payload: {event_type, eventId, userId, count, timestamp}
export const ANALYTICS_QUEUE = "analytics.usage"
export const ANALYTICS_QUEUE_TYPE = "quorum" as const
export const ANALYTICS_EVENT_TYPE = "usage_event" as const

export interface UsageEvent {
  event_type: typeof ANALYTICS_EVENT_TYPE
  eventId: string
  userId: string
  count: number
  timestamp: string
}

export class AnalyticsPublishError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = "AnalyticsPublishError"
    if (options?.cause !== undefined) {
      ;(this as any).cause = options.cause
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class AnalyticsPublisher {
  private channel: any | null = null
  private connection: any | null = null
  private connecting: Promise<void> | null = null
  private activeUrl: string | null = null
  private activeQueue: string = ANALYTICS_QUEUE
  private urlOverride: string | null = null

  /** HA/integration tests: point the singleton at a per-run broker without touching global env. */
  setUrlForTests(url: string | undefined) {
    this.urlOverride = url ?? null
    if (url && this.activeUrl && url !== this.activeUrl) this.invalidateChannel()
  }

  /** Close broker resources (idempotent). Safe to call when already closed. */
  async close(): Promise<void> {
    try { await this.channel?.close().catch(() => {}) } catch {}
    try { await this.connection?.close().catch(() => {}) } catch {}
    this.invalidateChannel()
  }

  /** Reset all cached state for tests (connection + URL override). */
  resetForTests() {
    this.channel = null
    this.connection = null
    this.connecting = null
    this.activeUrl = null
    this.activeQueue = ANALYTICS_QUEUE
    this.urlOverride = null
  }

  private resolveUrl(explicit?: string): string {
    return explicit ?? this.urlOverride ?? env.RABBITMQ_URL
  }

  private async ensureChannel(explicitUrl?: string, explicitQueue?: string): Promise<any> {
    const url = this.resolveUrl(explicitUrl)
    const queue = explicitQueue ?? ANALYTICS_QUEUE
    if (this.channel && this.activeUrl === url && this.activeQueue === queue) return this.channel
    if (this.channel && (this.activeUrl !== url || this.activeQueue !== queue)) {
      // Switching broker/queue between HA test cases: close stale channel first.
      try { await this.channel.close().catch(() => {}) } catch {}
      try { await this.connection?.close().catch(() => {}) } catch {}
      this.invalidateChannel()
    }
    if (this.connecting) await this.connecting
    if (this.channel && this.activeUrl === url && this.activeQueue === queue) return this.channel

    this.connecting = this.connect(url, queue)
    try {
      await this.connecting
      return this.channel!
    } finally {
      this.connecting = null
    }
  }

  private async connect(url: string, queue: string = ANALYTICS_QUEUE): Promise<void> {
    let conn: any
    try {
      conn = await amqp.connect(url)
    } catch (err) {
      try { metrics.analyticsPublishFailures.inc({ stage: "connect" }) } catch {}
      throw new AnalyticsPublishError("Failed to connect to RabbitMQ for analytics", { cause: err })
    }

    conn.on("error", (err: unknown) => console.error("AnalyticsPublisher connection error", err))
    conn.on("close", () => {
      this.channel = null
      this.connection = null
    })

    const ch = await conn.createChannel()
    ch.on("error", (err: unknown) => console.error("AnalyticsPublisher channel error", err))
    ch.on("close", () => {
      this.channel = null
    })

    try {
      await ch.assertQueue(queue, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": `${queue}_dlx`,
          "x-dead-letter-routing-key": queue,
          "x-queue-type": ANALYTICS_QUEUE_TYPE,
        },
      })
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      try { metrics.analyticsPublishFailures.inc({ stage: "assertQueue" }) } catch {}
      try { await ch.close().catch(() => {}) } catch {}
      try { await conn.close().catch(() => {}) } catch {}
      if (msg.includes("PRECONDITION_FAILED") || msg.includes("406")) {
        throw new AnalyticsPublishError(
          `Queue declare mismatch (406) for ${queue}: broker has incompatible args (classic vs quorum or missing DLX). Delete the stale queue or use a versioned queue name.`,
          { cause: err },
        )
      }
      throw new AnalyticsPublishError("Failed to assert analytics queue", { cause: err })
    }

    this.connection = conn
    this.channel = ch
    this.activeUrl = url
    this.activeQueue = queue
  }

  private invalidateChannel() {
    this.channel = null
    this.connection = null
    this.connecting = null
  }

  // Returns eventId. Throws AnalyticsPublishError; caller decides DB fallback.
  async publish(userId: string, count: number, eventId?: string, opts?: { url?: string; queue?: string }): Promise<string> {
    if (!userId || typeof userId !== "string" || !userId.trim()) {
      throw new AnalyticsPublishError("publish requires a non-empty userId")
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new AnalyticsPublishError(`publish requires a positive integer count, got ${String(count)}`)
    }
    const id = eventId ?? crypto.randomUUID()
    if (!UUID_RE.test(id)) {
      throw new AnalyticsPublishError(`publish requires a UUID eventId, got ${String(id)}`)
    }

    // Preview never dials the broker — all integrations are mocked.
    if (isPreviewMode()) return id

    const event: UsageEvent = {
      event_type: ANALYTICS_EVENT_TYPE,
      eventId: id,
      userId,
      count,
      timestamp: new Date().toISOString(),
    }
    const payload = Buffer.from(JSON.stringify(event))
    const queue = opts?.queue ?? ANALYTICS_QUEUE
    const url = opts?.url
    const sendOpts = {
      persistent: true,
      contentType: "application/json",
      messageId: id,
      timestamp: Date.now(),
      headers: { event_type: ANALYTICS_EVENT_TYPE },
    }

    const sendOnce = async (): Promise<void> => {
      const ch = await this.ensureChannel(url, queue)
      let accepted = false
      try {
        accepted = ch.sendToQueue(queue, payload, sendOpts)
      } catch (err) {
        this.invalidateChannel()
        throw err
      }
      // `false` = broker buffer full (backpressure). Treat as failure so the
      // caller retries instead of silently assuming delivery.
      if (accepted === false) {
        throw new AnalyticsPublishError("Broker buffer full (sendToQueue returned false)")
      }
    }

    try {
      await sendOnce()
      return id
    } catch (firstErr) {
      this.invalidateChannel()
      try { metrics.analyticsPublishFailures.inc({ stage: "publish" }) } catch {}
      try {
        await sendOnce()
        return id
      } catch (retryErr) {
        this.invalidateChannel()
        try { metrics.analyticsPublishFailures.inc({ stage: "dropped" }) } catch {}
        throw new AnalyticsPublishError("Analytics publish failed after retry; message not queued", {
          cause: retryErr ?? firstErr,
        })
      }
    }
  }
}

export const analyticsPublisher = new AnalyticsPublisher()
