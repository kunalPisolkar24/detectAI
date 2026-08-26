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
    /**
     * Selects due subscriptions with FOR UPDATE SKIP LOCKED and cancels them in one transaction.
     * `sweepTime` drives both the SELECT and UPDATE predicates so the sweep reads as one clock,
     * and is stamped onto swept rows as their eventTimestamp for webhook ordering.
     * Returns only the rows actually mutated, not merely selected.
     */
    expireDueSubscriptions(limit: number, data: BulkSubscriptionUpdate, sweepTime: Date): Promise<ExpiredSubscription[]>;
    incrementUsage(userId: string, count: number): Promise<void>;
    lockAndUpdateSubscription(
        userId: string,
        eventTimestamp: Date,
        status: SubscriptionStatus,
        payload: SubscriptionUpdateData,
        paddleCustomerId?: string
    ): Promise<SubscriptionUpdateResult>;
}
