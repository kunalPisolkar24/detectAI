import { type SubscriptionStatus } from "../../../../generated/prisma/client";

export interface UserRecord {
    email: string;
}

export interface SubscriptionUpdateData {
    paddleCustomerId: string;
    paddleSubscriptionId: string | null;
    paddlePlanId: string | null | undefined;
    status: SubscriptionStatus;
    endsAt: Date | null;
    cancellationScheduled?: boolean;
    eventTimestamp?: Date;
}

export interface BulkSubscriptionUpdate {
    status: SubscriptionStatus;
    cancellationScheduled?: boolean;
    paddleSubscriptionId?: string | null;
    paddlePlanId?: string | null;
    eventTimestamp?: Date;
}

export interface SubscriptionUpdateResult {
    email: string;
    stale: boolean;
}

export interface ExpiredSubscription {
    id: string;
    email: string;
    paddleSubscriptionId?: string | null;
    endsAt?: Date | string | null;
}
