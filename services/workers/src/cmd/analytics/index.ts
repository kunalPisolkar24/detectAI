import { initTracing } from "@shared/tracing/instrumentation";
initTracing("worker-analytics");

import { z } from "zod";
import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { AnalyticsService } from "@modules/analytics/application/services/AnalyticsService";
import { prisma, prismaPrimary, getPgPool, closePrisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { config } from "./config";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { UsageEventDeduplicator } from "@modules/analytics/infrastructure/UsageEventDeduplicator";

const QUEUE_NAME = "analytics.usage";

const UsageEventSchema = z.object({
  eventId: z.string().uuid().optional(),
  userId: z.string().min(1),
  count: z.number().int().positive(),
  timestamp: z.string().datetime().optional(),
});

const mainClient = RedisFactory.createClient({
  mode: config.REDIS_MODE,
  name: "AnalyticsMain",
  url: config.REDIS_URL,
  sentinels: config.REDIS_SENTINELS,
  masterName: config.REDIS_MASTER_NAME,
  password: (config as any).REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-analytics");
try {
  const primaryPool = getPgPool("primary");
  if (primaryPool) metricsService.registerPool("primary", primaryPool);
  const replicaPool = getPgPool("replica");
  if (replicaPool && replicaPool !== primaryPool) metricsService.registerPool("replica", replicaPool);
} catch {}

mainClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 1));
mainClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 1));
mainClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 0));
mainClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 0));

const userRepository = new PrismaUserRepository(prismaPrimary, prisma, undefined, metricsService);
const usageDeduplicator = new UsageEventDeduplicator(mainClient);
const analyticsService = new AnalyticsService(userRepository, mainClient, metricsService, usageDeduplicator);

const worker = new RabbitMQWorker(
  (config as any).RABBITMQ_URL,
  QUEUE_NAME,
  async (event: any) => {
    const result = UsageEventSchema.safeParse(event);
    if (!result.success) {
      Logger.warn("Invalid analytics usage event", { errors: result.error.format(), event });
      // Count as DLQ — don't silently ACK
      try { metricsService.deadLetteredTotal.inc({ job_type: "usage_event" }); } catch {}
      // Throw MissingFieldError-equivalent to route to DLQ via RabbitMQWorker isRetryable logic?
      // For now, return after metric — RabbitMQWorker will ACK (we handle DLQ here). Future group will throw.
      return;
    }
    await analyticsService.handleUsageEvent(result.data.userId, result.data.count, result.data.eventId);
  },
  metricsService,
  (config as any).RABBITMQ_QUEUE_TYPE ?? "classic"
);

let isShuttingDown = false;

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>(resolve => { timeout = setTimeout(() => resolve(fallback), ms); });
  promise.catch(() => {});
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const server = new WorkerServer(
  metricsService,
  config.PORT,
  () => {
    if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
    return { healthy: true, checks: { isShuttingDown } };
  },
  async () => {
    if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
    const pool = getPgPool("primary");
    const waiting = pool ? pool.waitingCount : 0;
    const poolPressured = waiting > 5;

    const dbOk = await withTimeout(
      prismaPrimary.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      3000,
      false
    );
    const redisOk = await withTimeout(
      (async () => {
        try {
          const res = await mainClient.ping();
          return res === "PONG" || mainClient.status === "ready";
        } catch { return false; }
      })(),
      3000,
      false
    );
    const workerOk = worker.getStatus();
    const healthy = dbOk && redisOk && workerOk && !poolPressured;
    return { healthy, checks: { db: dbOk, redis: redisOk, rabbitmq: workerOk, poolWaiting: waiting, poolPressured, isShuttingDown } };
  }
);

async function bootstrap(): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await withTimeout(prismaPrimary.$queryRaw`SELECT 1`, 3000, null as any);
      await withTimeout(mainClient.ping(), 3000, null as any);
      break;
    } catch (e: any) {
      Logger.warn(`Analytics bootstrap waiting for deps (attempt ${attempt}/5)`, { error: e instanceof Error ? e.message : String(e) });
      if (attempt < 5) await new Promise(r => setTimeout(r, 2000));
    }
  }
  server.start();
  metricsService.activeWorkers.inc();
  worker.start().catch((err) => {
    Logger.error("Analytics worker failed to start", err);
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  Logger.error("Analytics bootstrap failed", err);
  process.exit(1);
});

const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  try { server.stop(); } catch {}
  metricsService.activeWorkers.dec();
  try {
    await Promise.race([worker.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10000))]);
  } catch {}
  try {
    await Promise.race([mainClient.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 5000))]);
  } catch {}
  try { await closePrisma(); } catch {}
  Logger.info("Analytics Worker exited gracefully");
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("SIGQUIT", shutdown);
process.on("unhandledRejection", (reason: any) => Logger.error("Unhandled rejection in analytics worker", reason));
process.on("uncaughtException", (err: any) => Logger.error("Uncaught exception in analytics worker", err));
