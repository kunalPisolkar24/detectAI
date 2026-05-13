import { AnalyticsService } from "./services/AnalyticsService";
import { prisma } from "@shared/db";
import { Logger } from "@shared/logger";
import { RedisFactory } from "@shared/redis";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { config } from "./config";

const FLUSH_INTERVAL_MS = 5000;

import { PrismaUserRepository } from "@shared/repositories/UserRepository";

const usageClient = RedisFactory.createClient({
    mode: config.REDIS_USAGE_MODE,
    name: "AnalyticsUsage",
    url: config.REDIS_USAGE_URL,
});

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

usageClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsUsage" }, 1));
usageClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsUsage" }, 1));
usageClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsUsage" }, 0));
usageClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsUsage" }, 0));

mainClient.on("connect", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 1));
mainClient.on("ready", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 1));
mainClient.on("close", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 0));
mainClient.on("error", () => metricsService.redisConnectionStatus.set({ client_name: "AnalyticsMain" }, 0));

const userRepository = new PrismaUserRepository(prisma, prisma);
const analyticsService = new AnalyticsService(userRepository, usageClient, mainClient, metricsService);

const server = new WorkerServer(
    metricsService,
    config.PORT,
    () => usageClient.status === "ready" || usageClient.status === "connect"
);

server.start();

let isShuttingDown = false;

async function startWorker() {
    Logger.info("Analytics Worker started");
    metricsService.activeWorkers.inc();

    while (!isShuttingDown) {
        const startTime = Date.now();
        
        try {
            const processedCount = await analyticsService.processBatch();
            
            const duration = Date.now() - startTime;
            const timeToWait = Math.max(0, FLUSH_INTERVAL_MS - duration);
            
            if (processedCount > 0) {
                Logger.info(`Processed ${processedCount} records in ${duration}ms`);
            }

            await new Promise(resolve => setTimeout(resolve, timeToWait));

        } catch (error) {
            Logger.error("Critical error in analytics loop", error);
            metricsService.jobErrors.inc({ job_type: "main_loop", error_type: "critical" });
            await new Promise(resolve => setTimeout(resolve, FLUSH_INTERVAL_MS));
        }
    }
}

startWorker();

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    metricsService.activeWorkers.dec();
    
    Logger.info("Shutting down Analytics Worker...");
    
    await analyticsService.shutdown();
    await usageClient.quit();
    await mainClient.quit();
    await prisma.$disconnect();
    
    Logger.info("Analytics Worker exited gracefully");
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
