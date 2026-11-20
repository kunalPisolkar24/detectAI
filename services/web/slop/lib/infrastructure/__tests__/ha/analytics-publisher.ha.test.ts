/**
 * Publisher-only HA suite (3-node cluster, no Compose, no pg/redis).
 *
 * Runs under vitest.node.ha.config.ts ONLY (node env, no setup-node.ts
 * global mocks). Covers: quorum publish→consume, classic-vs-quorum 406,
 * pre-dial validation, broker-down AnalyticsPublishError + recovery, and
 * single-node kill with zero loss (quorum 2/3 majority).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import amqp from "amqplib"
import { startRabbitCluster, type RabbitCluster } from "../../../../test/ha/rabbitmq-cluster"
import {
  analyticsPublisher,
  AnalyticsPublishError,
  ANALYTICS_EVENT_TYPE,
} from "@/lib/infrastructure/analytics-publisher"

function uniqueQueue(base = "analytics.usage") {
  return `${base}_ha_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

describe("analytics-publisher HA (3-node cluster)", () => {
  let cluster: RabbitCluster
  let url: string

  beforeAll(async () => {
    cluster = await startRabbitCluster("guest", "guest")
    url = cluster.primaryUrl()
  }, 300_000)

  afterAll(async () => {
    await analyticsPublisher.resetForTests()
    await cluster?.cleanup().catch(() => {})
  }, 120_000)

  beforeEach(async () => {
    await analyticsPublisher.resetForTests()
  })

  it("publishes quorum queue and message is consumable with identical payload", async () => {
    const queue = uniqueQueue()
    const userId = `ha-user-${Date.now()}`
    const eventId = crypto.randomUUID()

    const returnedId = await analyticsPublisher.publish(userId, 3, eventId, { url, queue })
    expect(returnedId).toBe(eventId)

    const conn = await amqp.connect(url)
    try {
      const ch = await conn.createChannel()
      try {
        let raw: Buffer | null = null
        const deadline = Date.now() + 10_000
        while (!raw && Date.now() < deadline) {
          const msg = await ch.get(queue, { noAck: false })
          if (msg) {
            raw = Buffer.from(msg.content)
            ch.ack(msg)
          } else {
            await new Promise((r) => setTimeout(r, 500))
          }
        }
        expect(raw).not.toBeNull()
        const got = JSON.parse(raw!.toString())
        expect(got.event_type).toBe(ANALYTICS_EVENT_TYPE)
        expect(got.eventId).toBe(eventId)
        expect(got.userId).toBe(userId)
        expect(got.count).toBe(3)
      } finally {
        await ch.close().catch(() => {})
      }
    } finally {
      await conn.close().catch(() => {})
    }
    await analyticsPublisher.close()
  }, 60_000)

  it("classic redeclare of quorum queue fails 406", async () => {
    const queue = uniqueQueue()
    await analyticsPublisher.publish(`ha-user-${Date.now()}`, 1, crypto.randomUUID(), { url, queue })
    await analyticsPublisher.close()

    const conn = await amqp.connect(url)
    conn.on("error", () => {})
    try {
      const ch = await conn.createChannel()
      ch.on("error", () => {})
      let failed = false
      try {
        await Promise.race([
          ch.assertQueue(queue, { durable: true, arguments: {} }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("assert-timeout")), 5000)),
        ])
      } catch (e: unknown) {
        failed = /PRECONDITION_FAILED|406/.test(String((e as Error)?.message ?? e))
      }
      if (!failed) {
        await new Promise((r) => setTimeout(r, 500))
        // @ts-expect-error amqplib internals
        if (ch.closed) failed = true
      }
      expect(failed).toBe(true)
      try {
        // @ts-expect-error amqplib internals
        if (!ch.closed) await ch.close()
      } catch {}
    } finally {
      await conn.close().catch(() => {})
    }
  }, 60_000)

  it("rejects invalid input before dialing the broker", async () => {
    await expect(analyticsPublisher.publish("", 1, crypto.randomUUID(), { url, queue: uniqueQueue() })).rejects.toBeInstanceOf(
      AnalyticsPublishError,
    )
    await expect(
      analyticsPublisher.publish("user-1", 0, crypto.randomUUID(), { url, queue: uniqueQueue() }),
    ).rejects.toThrow(/positive integer/)
    await expect(analyticsPublisher.publish("user-1", 1, "not-a-uuid", { url, queue: uniqueQueue() })).rejects.toThrow(
      /UUID/,
    )
    await analyticsPublisher.resetForTests()
  }, 30_000)

  it("broker-down throws AnalyticsPublishError and singleton recovers afterwards", async () => {
    const badUrl = "amqp://guest:guest@127.0.0.1:1/"
    await expect(
      analyticsPublisher.publish("user-1", 1, crypto.randomUUID(), { url: badUrl, queue: uniqueQueue() }),
    ).rejects.toBeInstanceOf(AnalyticsPublishError)
    await analyticsPublisher.resetForTests()

    // Singleton must still work against the real cluster after the failure.
    const queue = uniqueQueue()
    const eventId = crypto.randomUUID()
    const returned = await analyticsPublisher.publish("user-1", 1, eventId, { url, queue })
    expect(returned).toBe(eventId)
    await analyticsPublisher.close()
  }, 60_000)

  it("survives single-node kill with zero loss", async () => {
    const queue = uniqueQueue()
    const N = 20
    for (let i = 0; i < N; i++) {
      await analyticsPublisher.publish(`ha-u-${i}-${Date.now()}`, 1, crypto.randomUUID(), { url, queue })
    }

    // Kill a follower; quorum majority (2/3) remains.
    await cluster.killNode(2)

    const survivor = cluster.primaryUrl()
    const conn = await amqp.connect(survivor)
    try {
      const ch = await conn.createChannel()
      try {
        const seen = new Set<string>()
        // Use a single long-lived consumer like the gateway HA suite (per-message
        // consumers miss messages after topology changes).
        const collected = await new Promise<string[]>((resolve) => {
          const acc: string[] = []
          ch.consume(
            queue,
            (msg) => {
              if (msg) acc.push(msg.content.toString())
              if (acc.length >= N) resolve(acc)
            },
            { noAck: true },
          ).catch(() => resolve(acc))
          setTimeout(() => resolve(acc), 30_000)
        })
        for (const b of collected) seen.add(b)
        expect(seen.size).toBe(N)
      } finally {
        await ch.close().catch(() => {})
      }
    } finally {
      await conn.close().catch(() => {})
    }
    await analyticsPublisher.close()
  }, 120_000)
})
