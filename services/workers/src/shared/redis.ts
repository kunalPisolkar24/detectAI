import Redis from "ioredis";
import { Logger } from "./logger";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
});

redis.on("error", (error) => {
    Logger.error("Redis connection error", error);
});

redis.on("connect", () => {
    Logger.info("Redis connected successfully");
});