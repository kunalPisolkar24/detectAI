import { SubscriptionSweeper } from "./services/SubscriptionSweeper";
import { prisma } from "@shared/db";
import { redis } from "@shared/redis";
import { Logger } from "@shared/logger";

const CHECK_INTERVAL_MS = 1000 * 60 * 60; // 1 Hour
const BATCH_COOLDOWN_MS = 5000; // 5 Seconds (if previous batch found data)
const ERROR_COOLDOWN_MS = 60000; // 1 Minute (if error occurs)

const sweeper = new SubscriptionSweeper();
let isShuttingDown = false;

async function startWorker() {
    Logger.info("Cron Worker (Subscription Sweeper) initializing...");
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
            await new Promise(resolve => setTimeout(resolve, ERROR_COOLDOWN_MS));
        }
    }
}

startWorker();

const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    Logger.info("Shutting down Cron Worker...");
    
    await prisma.$disconnect();
    await redis.quit();
    
    Logger.info("Cron Worker exited gracefully");
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);