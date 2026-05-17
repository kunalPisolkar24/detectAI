import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { CacheKeys } from "@shared/cache/keys";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { type PaddleEventData } from "../../domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

export class SubscriptionCanceledHandler implements IPaymentEventHandler {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly redis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    async handle(userId: string | null, data: PaddleEventData): Promise<void> {
        if (!userId) return;

        const subId = data.id;
        if (!subId) return;

        const user = await this.userRepository.findUniqueById(userId);
        if (!user) return;

        const endsAt = data.canceled_at ? new Date(data.canceled_at) : null;

        await this.userRepository.updateManyByIdAndSubscription(userId, subId, {
            status: SubscriptionStatus.CANCELED,
            endsAt: endsAt,
            cancellationScheduled: false,
            paddleSubscriptionId: null,
            paddlePlanId: null,
        });

        await this.invalidateUserCache(userId, user.email);
    }

    private async invalidateUserCache(userId: string, email: string): Promise<void> {
        const keys = [CacheKeys.user(userId), CacheKeys.userByEmail(email)];
        try {
            await this.redis.del(...keys);
            this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
        } catch (error) {
            this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "redis_error" });
        }
    }
}
