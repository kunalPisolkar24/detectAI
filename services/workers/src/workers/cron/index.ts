import { SubscriptionSweeper } from "./services/SubscriptionSweeper";
import { prisma } from "@shared/db";
import { RedisFactory } from "@shared/redis";
import { Logger } from "@shared/logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { WorkerServer } from "@shared/infrastructure/WorkerServer";
import { config } from "./config";

const CHECK_INTERVAL_MS = 1000 * 60 * 60; 
const BATCH_COOLDOWN_MS = 5000; 
const ERROR_COOLDOWN_MS = 60000; 

const redisClient = RedisFactory.createClient(
    {
        mode: config.REDIS_MODE,
        name: "CronRedis",
        url: config.REDIS_URL,
        sentinels: config.REDIS_SENTINELS,
        masterName: config.REDIS_MASTER_NAME,
        password: process.env.REDIS_PASSWORD,
    }
);

const metricsService = new MetricsService("worker-cron");
const sweeper = new SubscriptionSweeper(redisClient, metricsService);

const server = new WorkerServer(
    metricsService,
    config.PORT || 7777,
    () => redisClient.status === "ready" || redisClient.status === "connect"
);

server.start();

let isShuttingDown = false;

async function startWorker() {
    Logger.info("Cron Worker (Subscription Sweeper) initializing...");
    metricsService.activeWorkers.inc();
    await new Promise(resolve => setTimeout(resolve, 2000));

    Logger.info("Initialization complete. Running immediate startup sweep.");

    while (!isShuttingDown) {
        try {
            const processedCount = await sweeper.processExpiredSubscriptions();
            
            if (processedCount > 0) {
                Logger.info(`Sweeper processed ${processedCount} records. Checking for more in ${BATCH_COOLDOWN_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, BATCH_COOLDOWN_MS));
            } else {
                Logger.info(`No expired subscriptions found. Sleeping for ${CHECK_INTERVAL_MS / 1000 / 60} minutes.`);
                await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
            }

        } catch (error) {
            Logger.error("Critical error in Cron loop", error);
            metricsService.jobErrors.inc({ job_type: "cron_loop", error_type: "critical" });
            await new Promise(resolve => setTimeout(resolve, ERROR_COOLDOWN_MS));
        }
    }
}

startWorker();

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    metricsService.activeWorkers.dec();
    
    Logger.info("Shutting down Cron Worker...");
    
    await prisma.$disconnect();
    await redisClient.quit();
    
    Logger.info("Cron Worker exited gracefully");
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
