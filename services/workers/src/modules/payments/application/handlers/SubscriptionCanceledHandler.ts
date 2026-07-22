import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { CacheKeys } from "@shared/cache/keys";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import { type PaddleEventData } from "../../domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

const EVENT_TS_PREFIX = "payment:event:ts:";

export class SubscriptionCanceledHandler implements IPaymentEventHandler {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly redis: RedisClient,
        private readonly eventRedis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    async handle(userId: string | null, data: PaddleEventData): Promise<void> {
        if (!userId) return;

        const subId = data.id;
        if (!subId) return;

        const eventTimestamp = data.occurred_at ? new Date(data.occurred_at) : new Date();

        if (await this.isEventStale(userId, eventTimestamp)) return;

        const user = await this.userRepository.findUniqueById(userId);
        if (!user) return;

        const endsAt = data.canceled_at ? new Date(data.canceled_at) : null;

        await this.invalidateCache(userId, user.email);

        await this.userRepository.lockAndUpdateSubscription(
            userId,
            eventTimestamp,
            SubscriptionStatus.CANCELED,
            {
                paddleCustomerId: "",
                paddleSubscriptionId: null,
                paddlePlanId: null,
                status: SubscriptionStatus.CANCELED,
                endsAt,
                cancellationScheduled: false,
            }
        );

        await this.invalidateCache(userId, user.email);

        await this.setEventTimestamp(userId, eventTimestamp);
    }

    private async isEventStale(userId: string, eventTimestamp: Date): Promise<boolean> {
        try {
            const stored = await this.eventRedis.get(`${EVENT_TS_PREFIX}${userId}`);
            if (stored && eventTimestamp <= new Date(stored)) {
                Logger.info("Skipping stale event", { userId, eventTimestamp: eventTimestamp.toISOString(), stored });
                return true;
            }
        } catch (error) {
            Logger.warn("Event Redis pre-check failed, proceeding to PG", { userId, error });
        }
        return false;
    }

    private async invalidateCache(userId: string, email: string): Promise<void> {
        const keys = [CacheKeys.user(userId), CacheKeys.userByEmail(email)];
        try {
            await this.redis.del(...keys);
            this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
        } catch (error) {
            Logger.error("Failed to invalidate cache", error, { userId });
            this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "redis_error" });
        }
    }

    private async setEventTimestamp(userId: string, eventTimestamp: Date): Promise<void> {
        try {
            await this.eventRedis.set(`${EVENT_TS_PREFIX}${userId}`, eventTimestamp.toISOString());
        } catch (error) {
            Logger.warn("Failed to set event timestamp in Redis", { userId, error });
        }
    }
}
