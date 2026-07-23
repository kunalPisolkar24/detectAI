import { RabbitMQWorker } from "@shared/messaging/RabbitMQWorker";
import { AnalyticsService } from "@modules/analytics/application/services/AnalyticsService";
import { prisma } from "@shared/database/PrismaService";
import { Logger } from "@shared/logging/Logger";
import { RedisFactory } from "@shared/cache/RedisClient";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { config } from "./config";
import { PrismaUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";

const QUEUE_NAME = "analytics.usage";

const mainClient = RedisFactory.createClient({
  mode: config.REDIS_MODE,
  name: "AnalyticsMain",
  url: config.REDIS_URL,
  sentinels: config.REDIS_SENTINELS,
  masterName: config.REDIS_MASTER_NAME,
  password: process.env.REDIS_PASSWORD,
});

const metricsService = new MetricsService("worker-analytics");
metricsService.registerPool("primary", prisma);

mainClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 1));
mainClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 1));
mainClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 0));
mainClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 0));

const userRepository = new PrismaUserRepository(prisma, prisma);
const analyticsService = new AnalyticsService(userRepository, mainClient, metricsService);

const worker = new RabbitMQWorker(
  config.RABBITMQ_URL,
  QUEUE_NAME,
  async (event: any) => {
    await analyticsService.handleUsageEvent(event.userId, event.count);
  },
  metricsService,
  config.RABBITMQ_QUEUE_TYPE ?? "classic"
);

worker.start();
metricsService.activeWorkers.inc();

const server = new WorkerServer(
  metricsService,
  config.PORT,
  () => worker.getStatus()
);

server.start();

const shutdown = async () => {
  metricsService.activeWorkers.dec();
  await worker.shutdown();
  await mainClient.quit();
  await prisma.$disconnect();
  Logger.info("Analytics Worker exited gracefully");
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
