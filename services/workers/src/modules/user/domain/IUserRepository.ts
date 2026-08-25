import { type SubscriptionStatus } from "../../../generated/prisma/client";
import { type BulkSubscriptionUpdate, type ExpiredSubscription, type SubscriptionUpdateData, type SubscriptionUpdateResult, type UserRecord } from "./types";

/**
 * Status-transition guard injected by the composition root so the user
 * module stays independent of the payments domain rules.
 */
export type TransitionValidator = (
    current: SubscriptionStatus | null,
    next: SubscriptionStatus
) => void;

export interface IUserRepository {
    findUniqueById(userId: string): Promise<UserRecord | null>;
    bulkUpdateStatus(userIds: string[], data: BulkSubscriptionUpdate): Promise<{ count: number }>;
    findExpiredSubscriptionsWithLock(limit: number): Promise<ExpiredSubscription[]>;
    incrementUsage(userId: string, count: number): Promise<void>;
    lockAndUpdateSubscription(
        userId: string,
        eventTimestamp: Date,
        status: SubscriptionStatus,
        payload: SubscriptionUpdateData,
        paddleCustomerId?: string
    ): Promise<SubscriptionUpdateResult>;
}
