import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { CacheKeys } from "@shared/cache/keys";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import { type PaddleEventData, type PaymentUpdatePayload } from "../../domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

const EVENT_TS_PREFIX = "payment:event:ts:";

export class SubscriptionUpdatedHandler implements IPaymentEventHandler {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly redis: RedisClient,
        private readonly eventRedis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    async handle(userId: string | null, data: PaddleEventData): Promise<void> {
        if (!userId) return;

        const status = this.parseStatus(data.status);
        const subId = data.id;
        const customerId = data.customer_id;
        const planId = data.items?.[0]?.price?.id;
        const endsAt = this.parseEndsAt(data);

        if (!subId || !status || !customerId || !planId) return;

        const eventTimestamp = data.occurred_at ? new Date(data.occurred_at) : new Date();

        if (await this.isEventStale(userId, eventTimestamp)) return;

        const user = await this.userRepository.findUniqueById(userId);
        if (!user) return;

        const updateData: PaymentUpdatePayload = {
            paddleCustomerId: customerId,
            paddleSubscriptionId: subId,
            paddlePlanId: planId,
            status,
            endsAt,
        };

        if (data?.scheduled_change) {
            updateData.cancellationScheduled = data.scheduled_change.action === "cancel";
        }

        await this.invalidateCache(userId, user.email);

        const result = await this.userRepository.lockAndUpdateSubscription(userId, eventTimestamp, status, updateData, customerId);

        if (!result.stale) {
            await this.invalidateCache(userId, result.email);
            await this.setEventTimestamp(userId, eventTimestamp);
        }
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

    private parseStatus(status?: string): SubscriptionStatus | null {
        if (!status) return null;
        const s = status.toUpperCase();
        if (Object.values(SubscriptionStatus).includes(s as SubscriptionStatus)) {
            return s as SubscriptionStatus;
        }
        return null;
    }

    private parseEndsAt(data: PaddleEventData): Date | null {
        const raw = data?.current_billing_period?.ends_at || data?.scheduled_change?.effective_at;
        return raw ? new Date(raw) : null;
    }
}
