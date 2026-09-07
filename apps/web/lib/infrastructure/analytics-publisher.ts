/* eslint-disable @typescript-eslint/no-explicit-any */
import amqp from "amqplib"
import { env } from "@/lib/config/env"
import { metrics } from "@/lib/infrastructure/metrics"

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

/**
 * Analytics queue contract (must match worker consumer).
 *
 * Queue: `analytics.usage`, type `quorum`, durable, DLX `analytics.usage_dlx`.
 * Payload v1: `{ event_type: "usage_event", eventId: uuid, userId, count: int>0, timestamp: ISO }`.
 * `eventId` is the idempotency key — callers must generate it once per logical
 * usage event and reuse it across retries. `event_type` routes worker metrics
 * (without it the worker labels the job `other`).
 */
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

  private async ensureChannel(): Promise<any> {
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
    let conn: any
    try {
      conn = await amqp.connect(env.RABBITMQ_URL)
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
      await ch.assertQueue(ANALYTICS_QUEUE, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": `${ANALYTICS_QUEUE}_dlx`,
          "x-dead-letter-routing-key": ANALYTICS_QUEUE,
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
          `Queue declare mismatch (406) for ${ANALYTICS_QUEUE}: broker has incompatible args (classic vs quorum or missing DLX). Delete the stale queue or use a versioned queue name.`,
          { cause: err },
        )
      }
      throw new AnalyticsPublishError("Failed to assert analytics queue", { cause: err })
    }

    this.connection = conn
    this.channel = ch
  }

  private invalidateChannel() {
    this.channel = null
    this.connection = null
    this.connecting = null
  }

  /**
   * Publish a usage event. Returns the `eventId` used (generated when omitted,
   * including in preview mode where nothing is sent).
   *
   * @throws {AnalyticsPublishError} when the broker is unreachable or the
   *   queue rejects the message. Callers must NOT swallow this silently —
   *   `trackUsage` uses it to decide whether the DB fallback is safe.
   */
  async publish(userId: string, count: number, eventId?: string): Promise<string> {
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
    const opts = {
      persistent: true,
      contentType: "application/json",
      messageId: id,
      timestamp: Date.now(),
      headers: { event_type: ANALYTICS_EVENT_TYPE },
    }

    const sendOnce = async (): Promise<void> => {
      const ch = await this.ensureChannel()
      let accepted = false
      try {
        accepted = ch.sendToQueue(ANALYTICS_QUEUE, payload, opts)
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
