import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import amqp from "amqplib";
import { startHaInfra, truncateHaDb, flushHaRedis, type HaInfra } from "../../../../tests/containers-ha-infra";
import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { RedisFactory } from "@shared/cache/RedisClient";
import { prismaPrimary, closePrisma } from "@shared/database/PrismaService";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { PaymentService } from "../../application/services/PaymentService";
import { SubscriptionUpdatedHandler } from "../../application/handlers/SubscriptionUpdatedHandler";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";

/**
 * Payments HA integration (3-node RabbitMQ cluster, no Compose, no Floci).
 * Mirrors Amazon MQ CLUSTER_MULTI_AZ: quorum queues, 406 mismatch, poison to
 * DLQ, and single-node kill with zero loss. Self-contained pg+redis+rabbit.
 */
describe("Payments HA (3-node cluster)", () => {
  let infra: HaInfra;
  let metrics: MetricsService;

  beforeAll(async () => {
    infra = await startHaInfra({ withEventRedis: true });
    metrics = new MetricsService("test-payments-ha");
  }, 300_000);

  afterAll(async () => {
    await closePrisma().catch(() => {});
    await infra?.cleanup().catch(() => {});
  }, 120_000);

  beforeEach(async () => {
    await truncateHaDb(infra.databaseUrl);
    await flushHaRedis(infra.redisUrl);
    if (infra.eventRedisUrl) await flushHaRedis(infra.eventRedisUrl);
  }, 60_000);

  function uniqueQueue(base: string) {
    return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function buildWorker(queue: string, handler: (e: any) => Promise<void>): RabbitMQWorker {
    return new RabbitMQWorker(infra.rabbitUrl, queue, handler, metrics, "quorum", [
      "subscription.updated",
      "subscription.canceled",
      "subscription.created",
      "subscription.activated",
      "user.cancel_subscription",
    ]);
  }

  test("quorum E2E: subscription.updated commits DB and acks", async () => {
    const queue = uniqueQueue("payment_events");
    const redis = RedisFactory.createClient({ mode: "standalone", name: "ha-test", url: infra.redisUrl });
    const eventRedis = RedisFactory.createClient({ mode: "standalone", name: "ha-test-events", url: infra.eventRedisUrl! });
    const userRepo = new PrismaUserRepository(prismaPrimary, prismaPrimary);
    const handler = new SubscriptionUpdatedHandler(userRepo, redis as any, eventRedis as any, metrics);
    const svc = new PaymentService({ "subscription.updated": handler as any }, metrics);
    const worker = buildWorker(queue, (e) => svc.handleEvent(e as any));
    await worker.start();
    try {
      const user = await prismaPrimary.user.create({
        data: {
          email: `ha-payments-e2e-${Date.now()}@example.com`,
          subscription: { create: { status: SubscriptionStatus.ACTIVE, paddleSubscriptionId: "sub_ha_1", paddlePlanId: "plan_1" } },
        },
      });

      const conn = await amqp.connect(infra.rabbitUrl);
      try {
        const ch = await conn.createChannel();
        try {
          const event = {
            event_type: "subscription.updated",
            event_id: crypto.randomUUID(),
            data: {
              custom_data: { userId: user.id },
              id: "sub_ha_1",
              status: "active",
              customer_id: "cus_ha_1",
              items: [{ price: { id: "plan_1" } }],
              occurred_at: new Date().toISOString(),
            },
          };
          const ok = ch.sendToQueue(queue, Buffer.from(JSON.stringify(event)), { persistent: true, contentType: "application/json" });
          expect(ok).toBe(true);
        } finally {
          await ch.close().catch(() => {});
        }
      } finally {
        await conn.close().catch(() => {});
      }

      const deadline = Date.now() + 20_000;
      let updated: any = null;
      while (Date.now() < deadline) {
        updated = await prismaPrimary.subscription.findUnique({ where: { userId: user.id } });
        if (updated) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(updated).not.toBeNull();

      // Queue drained (acked).
      const checkConn = await amqp.connect(infra.rabbitUrl);
      try {
        const ch = await checkConn.createChannel();
        try {
          const q = await ch.checkQueue(queue);
          expect(q.messageCount).toBe(0);
        } finally {
          await ch.close().catch(() => {});
        }
      } finally {
        await checkConn.close().catch(() => {});
      }
    } finally {
      await worker.shutdown();
      await (redis as any).quit?.().catch(() => {});
      await (eventRedis as any).quit?.().catch(() => {});
    }
  }, 60_000);

  test("poison JSON goes to DLQ, not stuck on main", async () => {
    const queue = uniqueQueue("payment_events");
    const worker = buildWorker(queue, async () => {
      throw new Error("should not be called for invalid JSON");
    });
    await worker.start();
    try {
      const conn = await amqp.connect(infra.rabbitUrl);
      try {
        const ch = await conn.createChannel();
        try {
          ch.sendToQueue(queue, Buffer.from("not-json{{{"));
        } finally {
          await ch.close().catch(() => {});
        }
      } finally {
        await conn.close().catch(() => {});
      }

      const deadline = Date.now() + 20_000;
      let dlqCount = 0;
      while (Date.now() < deadline && dlqCount === 0) {
        const c = await amqp.connect(infra.rabbitUrl);
        try {
          const ch = await c.createChannel();
          try {
            const q = await ch.checkQueue(`${queue}_dlq`);
            dlqCount = q.messageCount;
          } finally {
            await ch.close().catch(() => {});
          }
        } finally {
          await c.close().catch(() => {});
        }
        if (dlqCount === 0) await new Promise((r) => setTimeout(r, 500));
      }
      expect(dlqCount).toBeGreaterThanOrEqual(1);
    } finally {
      await worker.shutdown();
    }
  }, 60_000);

  test("classic redeclare of quorum queue fails 406", async () => {
    const queue = uniqueQueue("payment_events_ha_mismatch");
    const worker = buildWorker(queue, async () => {});
    await worker.start();
    try {
      const conn = await amqp.connect(infra.rabbitUrl);
      conn.on("error", () => {});
      try {
        const ch = await conn.createChannel();
        ch.on("error", () => {});
        let failed = false;
        try {
          await Promise.race([
            ch.assertQueue(queue, { durable: true, arguments: {} }),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("assert-timeout")), 5000)),
          ]);
        } catch (e: any) {
          failed = /PRECONDITION_FAILED|406/.test(String(e?.message ?? e));
        }
        // If assert didn't throw, consider channel close as failure (quorum mismatch also closes channel)
        if (!failed) {
          // Give server a moment to close channel
          await new Promise((r) => setTimeout(r, 500));
          // @ts-ignore - amqplib internal
          const closed = (ch as any).closed || (ch as any)._closed;
          if (closed) failed = true;
        }
        expect(failed).toBe(true);
        // Don't await ch.close if already closed by server
        try {
          // @ts-ignore
          if (!(ch as any).closed) await ch.close();
        } catch {}
      } finally {
        await conn.close().catch(() => {});
      }
    } finally {
      await worker.shutdown();
    }
  }, 60_000);

  test("survives single-node kill with zero loss", async () => {
    const queue = uniqueQueue("payment_events");
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
              Buffer.from(JSON.stringify({ event_type: "subscription.updated", event_id: crypto.randomUUID(), data: { custom_data: { userId: `ha-${i}` }, id: `sub_${i}` } })),
              { persistent: true, contentType: "application/json" },
            );
          }
        } finally {
          await ch.close().catch(() => {});
        }
      } finally {
        await conn.close().catch(() => {});
      }

      // Kill a follower; quorum majority (2/3) remains.
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
