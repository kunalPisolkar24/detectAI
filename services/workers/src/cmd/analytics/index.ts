import { loadAnalyticsConfig } from "./config";
import { initTracing } from "@shared/tracing/instrumentation";
import { z } from "zod";
import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { AnalyticsService } from "@modules/analytics/application/services/AnalyticsService";
import { prismaPrimary, prisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/http/WorkerServer";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { UsageEventDeduplicator } from "@modules/analytics/infrastructure/UsageEventDeduplicator";
import { withTimeout } from "@shared/utils/withTimeout";
import { MissingFieldError } from "@shared/errors/AppError";
import { checkDb, checkRedis, registerPools, wireRedisMetrics, getPoolWaiting, isPoolPressured } from "@shared/health/checks";

const QUEUE_NAME = "analytics.usage";

const UsageEventSchema = z.object({
  event_type: z.literal("usage_event").optional(),
  type: z.literal("usage_event").optional(),
  eventId: z.string().uuid(),
  userId: z.string().min(1),
  count: z.number().int().positive(),
  timestamp: z.string().datetime().optional(),
});

async function main(): Promise<void> {
  const config = await loadAnalyticsConfig();
  initTracing(config.OTEL_SERVICE_NAME ?? "worker-analytics");

  const mainClient = RedisFactory.createClient({
    name: "AnalyticsMain",
    url: config.REDIS_URL,
    password: config.REDIS_PASSWORD,
  });

  const metricsService = new MetricsService("worker-analytics");
  registerPools(metricsService);
  wireRedisMetrics(mainClient, metricsService, "AnalyticsMain");

  const userRepository = new PrismaUserRepository(prismaPrimary, prisma, undefined, metricsService);
  const usageDeduplicator = new UsageEventDeduplicator(mainClient);
  const analyticsService = new AnalyticsService(userRepository, metricsService, usageDeduplicator);

  const worker = new RabbitMQWorker(
    config.RABBITMQ_URL!,
    QUEUE_NAME,
    async (event: any) => {
      if (typeof event?.userId === "string" && event.userId.startsWith("preview-")) {
        Logger.warn("Dropping preview usage event", { userId: event.userId });
        try {
          metricsService.staleEventsFilteredTotal.inc({ reason: "preview" });
        } catch {}
        return;
      }
      const result = UsageEventSchema.safeParse(event);
      if (!result.success) {
        Logger.warn("Invalid analytics usage event", { errors: result.error.format(), event });
        throw new MissingFieldError("usage_event: eventId/userId/count failed validation");
      }
      await analyticsService.handleUsageEvent(result.data.userId, result.data.count, result.data.eventId);
    },
    metricsService,
    ["usage_event"],
    {
      prefetch: config.RABBITMQ_PREFETCH,
      infraRequeueDelayMs: config.INFRA_REQUEUE_DELAY_MS,
      isInfraHealthy: checkDb,
    }
  );

  let isShuttingDown = false;

  const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => (isShuttingDown ? { healthy: false, checks: { isShuttingDown: true } } : { healthy: true, checks: { isShuttingDown } }),
    async () => {
      if (isShuttingDown) return { healthy: false, checks: { isShuttingDown: true } };
      const waiting = getPoolWaiting();
      const poolPressured = isPoolPressured();
      const dbOk = await checkDb();
      const redisOk = await checkRedis(mainClient);
      const workerOk = worker.getStatus();
      const healthy = dbOk && redisOk && workerOk && !poolPressured;
      return { healthy, checks: { db: dbOk, redis: redisOk, dedupRedis: redisOk, rabbitmq: workerOk, poolWaiting: waiting, poolPressured, isShuttingDown } };
    }
  );

  const db = await withTimeout(prismaPrimary.$queryRaw`SELECT 1`.then(() => true).catch(() => null), 3000, null as any);
  const redis = await withTimeout(mainClient.ping().then(() => true).catch(() => null), 3000, null as any);
  if (!db || !redis) {
    Logger.warn("Analytics starting degraded (deps will be retried in background)", { dbOk: !!db, redisOk: !!redis, dedupOk: !!redis });
  }
  server.start();
  metricsService.activeWorkers.inc();
  worker.start().catch((err) => {
    Logger.error("Analytics worker failed to start", err);
    process.exit(1);
  });

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    try {
      server.stop();
    } catch {}
    try {
      metricsService.activeWorkers.dec();
    } catch {}
    try {
      await Promise.race([worker.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10000))]);
    } catch {}
    try {
      await Promise.race([mainClient.quit(), new Promise((_, rej) => setTimeout(() => rej(new Error("quit timeout")), 5000))]);
    } catch {}
    try {
      const { closePrisma } = await import("@shared/database/PrismaService");
      await closePrisma();
    } catch {}
    Logger.info("Analytics Worker exited gracefully");
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGQUIT", shutdown);
  process.on("unhandledRejection", (reason: any) => Logger.error("Unhandled rejection in analytics worker", reason));
  process.on("uncaughtException", (err: any) => Logger.error("Uncaught exception in analytics worker", err));
}

main().catch((err) => {
  Logger.error("Analytics bootstrap failed", err);
  process.exit(1);
});
