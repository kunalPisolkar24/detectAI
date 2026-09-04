import { initTracing } from "@shared/tracing/instrumentation";
initTracing("worker-analytics");

import { z } from "zod";
import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { AnalyticsService } from "@modules/analytics/application/services/AnalyticsService";
import { prisma, prismaPrimary, closePrisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { config } from "./config";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { UsageEventDeduplicator } from "@modules/analytics/infrastructure/UsageEventDeduplicator";
import { withTimeout } from "@shared/utils/withTimeout";
import { registerPools, wireRedisMetrics, getPoolWaiting, isPoolPressured, checkDb, checkRedis } from "@shared/health/checks";

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

// Use persistent EventRedis for dedup if configured, otherwise fallback to main (LRU risk documented)
const cfgAny = config as any;
const dedupClient = cfgAny.EVENT_REDIS_URL
  ? RedisFactory.createClient({
      mode: cfgAny.EVENT_REDIS_MODE ?? "standalone",
      name: "AnalyticsDedup",
      url: cfgAny.EVENT_REDIS_URL,
      sentinels: cfgAny.EVENT_REDIS_SENTINELS,
      masterName: cfgAny.EVENT_REDIS_MASTER_NAME,
      password: cfgAny.EVENT_REDIS_PASSWORD,
    })
  : mainClient;

const metricsService = new MetricsService("worker-analytics");
registerPools(metricsService);

wireRedisMetrics(mainClient, metricsService, "AnalyticsMain");
if (dedupClient !== mainClient) {
  wireRedisMetrics(dedupClient, metricsService, "AnalyticsDedup");
}

const userRepository = new PrismaUserRepository(prismaPrimary, prisma, undefined, metricsService);
const usageDeduplicator = new UsageEventDeduplicator(dedupClient);
const analyticsService = new AnalyticsService(userRepository, mainClient, metricsService, usageDeduplicator);

// analytics.usage publisher (web) asserts quorum; consumer must match to avoid 406
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
  "quorum"
);

let isShuttingDown = false;

const server = new WorkerServer(
  metricsService,
  config.PORT,
  () => {
    if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
    return { healthy: true, checks: { isShuttingDown } };
  },
  async () => {
    if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
    const waiting = getPoolWaiting();
    const poolPressured = isPoolPressured();
    const dbOk = await checkDb();
    const redisOk = await checkRedis(mainClient);
    let dedupOk = true;
    if (dedupClient !== mainClient) {
      dedupOk = await checkRedis(dedupClient);
    }
    const workerOk = worker.getStatus();
    const healthy = dbOk && redisOk && dedupOk && workerOk && !poolPressured;
    return { healthy, checks: { db: dbOk, redis: redisOk, dedupRedis: dedupOk, rabbitmq: workerOk, poolWaiting: waiting, poolPressured, isShuttingDown } };
  }
);

async function bootstrap(): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await withTimeout(prismaPrimary.$queryRaw`SELECT 1`, 3000, null as any);
      await withTimeout(mainClient.ping(), 3000, null as any);
      if (dedupClient !== mainClient) await withTimeout(dedupClient.ping(), 3000, null as any);
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
  if (dedupClient !== mainClient) {
    try {
      await Promise.race([dedupClient.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 5000))]);
    } catch {}
  }
  try { await closePrisma(); } catch {}
  Logger.info("Analytics Worker exited gracefully");
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("SIGQUIT", shutdown);
process.on("unhandledRejection", (reason: any) => Logger.error("Unhandled rejection in analytics worker", reason));
process.on("uncaughtException", (err: any) => Logger.error("Uncaught exception in analytics worker", err));
