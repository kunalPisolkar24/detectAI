import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import amqp from "amqplib";
import { startHaInfra, truncateHaDb, flushHaRedis, type HaInfra } from "../../../../tests/containers-ha-infra";
import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { prismaPrimary, closePrisma } from "@shared/database/PrismaService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { AnalyticsService } from "../../application/services/AnalyticsService";
import { UsageEventDeduplicator } from "../../infrastructure/UsageEventDeduplicator";

/**
 * Analytics HA integration (3-node RabbitMQ cluster, no Compose, no Floci).
 * Queue analytics.usage is quorum (matches web publisher + worker consumer).
 * Verifies E2E, exactly-once dedup, invalid to DLQ, and single-node kill.
 */
describe("Analytics HA (3-node cluster)", () => {
  let infra: HaInfra;
  let metrics: MetricsService;

  beforeAll(async () => {
    infra = await startHaInfra({ withEventRedis: false });
    metrics = new MetricsService("test-analytics-ha");
  }, 300_000);

  afterAll(async () => {
    await closePrisma().catch(() => {});
    await infra?.cleanup().catch(() => {});
  }, 120_000);

  beforeEach(async () => {
    await truncateHaDb(infra.databaseUrl);
    await flushHaRedis(infra.redisUrl);
  }, 60_000);

  function uniqueQueue(base: string) {
    return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function buildWorker(queue: string, handler: (e: any) => Promise<void>): RabbitMQWorker {
    return new RabbitMQWorker(infra.rabbitUrl, queue, handler, metrics, ["usage_event"]);
  }

  function buildService(redis: any): AnalyticsService {
    const userRepo = new PrismaUserRepository(prismaPrimary, prismaPrimary);
    const dedup = new UsageEventDeduplicator(redis);
    return new AnalyticsService(userRepo, metrics, dedup);
  }

  test("quorum E2E: usage_event increments Usage", async () => {
    const queue = uniqueQueue("analytics.usage");
    const redis: any = RedisFactory.createClient({ name: "ha-analytics", url: infra.redisUrl });
    try {
      const svc = buildService(redis);
      const worker = buildWorker(queue, async (e) => {
        if (typeof e?.userId === "string" && e.userId.startsWith("preview-")) return;
        await svc.handleUsageEvent(e.userId, e.count, e.eventId);
      });
      await worker.start();
      try {
        const user = await prismaPrimary.user.create({ data: { email: `ha-analytics-${Date.now()}@example.com` } });
        const eventId = crypto.randomUUID();
        const conn = await amqp.connect(infra.rabbitUrl);
        try {
          const ch = await conn.createChannel();
          try {
            ch.sendToQueue(
              queue,
              Buffer.from(JSON.stringify({ event_type: "usage_event", eventId, userId: user.id, count: 7, timestamp: new Date().toISOString() })),
              { persistent: true, contentType: "application/json" },
            );
          } finally {
            await ch.close().catch(() => {});
          }
        } finally {
          await conn.close().catch(() => {});
        }

        const deadline = Date.now() + 20_000;
        let usage: any = null;
        while (Date.now() < deadline) {
          usage = await prismaPrimary.usage.findUnique({ where: { userId: user.id } });
          if (usage?.apiCallCountTotal === 7) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(usage?.apiCallCountTotal).toBe(7);
      } finally {
        await worker.shutdown();
      }
    } finally {
      await redis.quit?.().catch(() => {});
    }
  }, 60_000);

  test("duplicate eventId counts exactly once", async () => {
    const queue = uniqueQueue("analytics.usage");
    const redis: any = RedisFactory.createClient({ name: "ha-analytics-dedup", url: infra.redisUrl });
    try {
      const svc = buildService(redis);
      const worker = buildWorker(queue, async (e) => {
        await svc.handleUsageEvent(e.userId, e.count, e.eventId);
      });
      await worker.start();
      try {
        const user = await prismaPrimary.user.create({ data: { email: `ha-dedup-${Date.now()}@example.com` } });
        const eventId = crypto.randomUUID();
        const payload = (count: number) =>
          Buffer.from(JSON.stringify({ event_type: "usage_event", eventId, userId: user.id, count, timestamp: new Date().toISOString() }));
        const conn = await amqp.connect(infra.rabbitUrl);
        try {
          const ch = await conn.createChannel();
          try {
            ch.sendToQueue(queue, payload(5), { persistent: true, contentType: "application/json" });
            // Second delivery with same eventId (redelivery / retry) must not double-count.
            await new Promise((r) => setTimeout(r, 500));
            ch.sendToQueue(queue, payload(5), { persistent: true, contentType: "application/json" });
          } finally {
            await ch.close().catch(() => {});
          }
        } finally {
          await conn.close().catch(() => {});
        }

        const deadline = Date.now() + 20_000;
        let total = 0;
        while (Date.now() < deadline) {
          const u: any = await prismaPrimary.usage.findUnique({ where: { userId: user.id } });
          total = u?.apiCallCountTotal ?? 0;
          if (total === 5) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(total).toBe(5);
        // Give the duplicate time to (incorrectly) double-count if dedup were broken.
        await new Promise((r) => setTimeout(r, 3000));
        const final: any = await prismaPrimary.usage.findUnique({ where: { userId: user.id } });
        expect(final?.apiCallCountTotal).toBe(5);
      } finally {
        await worker.shutdown();
      }
    } finally {
      await redis.quit?.().catch(() => {});
    }
  }, 60_000);

  test("invalid usage event goes to DLQ", async () => {
    const queue = uniqueQueue("analytics.usage");
    const redis: any = RedisFactory.createClient({ name: "ha-analytics-dlq", url: infra.redisUrl });
    try {
      const svc = buildService(redis);
      const worker = buildWorker(queue, async (e) => {
        // Mirror cmd/analytics validation: missing eventId => non-retryable => DLQ.
        if (!e?.eventId || !e?.userId || typeof e?.count !== "number") {
          const { MissingFieldError } = await import("../../../payments/domain/errors");
          throw new MissingFieldError("usage_event invalid");
        }
        await svc.handleUsageEvent(e.userId, e.count, e.eventId);
      });
      await worker.start();
      try {
        const conn = await amqp.connect(infra.rabbitUrl);
        try {
          const ch = await conn.createChannel();
          try {
            ch.sendToQueue(queue, Buffer.from(JSON.stringify({ event_type: "usage_event", userId: "x", count: 1 })), {
              persistent: true,
              contentType: "application/json",
            });
          } finally {
            await ch.close().catch(() => {});
          }
        } finally {
          await conn.close().catch(() => {});
        }

        const deadline = Date.now() + 20_000;
        let dlq = 0;
        while (Date.now() < deadline && dlq === 0) {
          const c = await amqp.connect(infra.rabbitUrl);
          try {
            const ch = await c.createChannel();
            try {
              dlq = (await ch.checkQueue(`${queue}_dlq`)).messageCount;
            } finally {
              await ch.close().catch(() => {});
            }
          } finally {
            await c.close().catch(() => {});
          }
          if (dlq === 0) await new Promise((r) => setTimeout(r, 500));
        }
        expect(dlq).toBeGreaterThanOrEqual(1);
      } finally {
        await worker.shutdown();
      }
    } finally {
      await redis.quit?.().catch(() => {});
    }
  }, 60_000);

  test("survives single-node kill with zero loss", async () => {
    const queue = uniqueQueue("analytics.usage");
    let received = 0;
    const worker = buildWorker(queue, async () => {
      received++;
    });
    await worker.start();
    try {
      const N = 20;
      const conn = await amqp.connect(infra.rabbitUrl);
      try {
        const ch = await conn.createChannel();
        try {
          for (let i = 0; i < N; i++) {
            ch.sendToQueue(
              queue,
              Buffer.from(
                JSON.stringify({ event_type: "usage_event", eventId: crypto.randomUUID(), userId: `ha-u-${i}`, count: 1, timestamp: new Date().toISOString() }),
              ),
              { persistent: true, contentType: "application/json" },
            );
          }
        } finally {
          await ch.close().catch(() => {});
        }
      } finally {
        await conn.close().catch(() => {});
      }

      await infra.rabbit.killNode(2);

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && received < N) {
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(received).toBe(N);
      expect(worker.getStatus()).toBe(true);
    } finally {
      await worker.shutdown();
    }
  }, 120_000);
});
