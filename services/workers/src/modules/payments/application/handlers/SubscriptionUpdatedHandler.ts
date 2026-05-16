import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { CacheKeys } from "@shared/cache/keys";
import { LockService } from "@shared/cache/lock";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { type PaddleEventData, type PaymentUpdatePayload } from "../../domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

export class SubscriptionUpdatedHandler implements IPaymentEventHandler {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly redis: RedisClient,
        private readonly lockService: LockService,
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

        const updatedUser = await this.userRepository.updateById(userId, updateData, { email: true });
        await this.invalidateUserCache(userId, updatedUser.email);
    }

    private async invalidateUserCache(userId: string, email: string): Promise<void> {
        const keys = [CacheKeys.user(userId), CacheKeys.userByEmail(email)];

        try {
            const locks = await Promise.all(keys.map(key => this.lockService.acquire(key)));
            try {
                await this.redis.del(...keys);
                this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
            } finally {
                await Promise.all(locks.map(release => release ? release() : Promise.resolve()));
            }
        } catch (error) {
            await this.redis.del(...keys).catch(() => {});
            this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "lock_failure" });
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
