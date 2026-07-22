import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { type IPaddleClient } from "../../infrastructure/external/PaddleClient";
import { type PaddleEventData } from "../../domain/types";
import { Logger } from "@shared/logging/Logger";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

const EVENT_TS_PREFIX = "payment:event:ts:";

export class UserCancelHandler implements IPaymentEventHandler {
    constructor(
        private readonly userRepository: IUserRepository,
        private readonly paddleClient: IPaddleClient,
        private readonly eventRedis: RedisClient
    ) {}

    async handle(userId: string | null, data: PaddleEventData): Promise<void> {
        const paddleSubscriptionId = (data as any).paddleSubscriptionId as string | undefined;
        if (!paddleSubscriptionId) {
            throw new Error("Missing subscription ID");
        }

        const resolvedUserId = userId ?? data.custom_data?.userId ?? (data as any).userId ?? null;
        if (!resolvedUserId) {
            throw new Error("Missing userId for cancel subscription");
        }

        const eventTimestamp = data.occurred_at ? new Date(data.occurred_at) : new Date();

        if (await this.isEventStale(resolvedUserId, eventTimestamp)) return;

        const currentStatus = await this.userRepository.getSubscriptionStatusWithLock(resolvedUserId);

        if (currentStatus === SubscriptionStatus.CANCELED) {
            Logger.info("Subscription already canceled, skipping Paddle API call", { userId: resolvedUserId, paddleSubscriptionId });
            return;
        }

        await this.paddleClient.cancelSubscription(paddleSubscriptionId);

        await this.setEventTimestamp(resolvedUserId, eventTimestamp);
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

    private async setEventTimestamp(userId: string, eventTimestamp: Date): Promise<void> {
        try {
            await this.eventRedis.set(`${EVENT_TS_PREFIX}${userId}`, eventTimestamp.toISOString());
        } catch (error) {
            Logger.warn("Failed to set event timestamp in Redis", { userId, error });
        }
    }
}
