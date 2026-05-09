import { SubscriptionStatus } from "../../../generated/prisma/client";
import { type PaymentUpdatePayload } from "../../workers/payments/types";

export interface UserRecord {
    email: string;
}

export interface IUserRepository {
    updateById(userId: string, data: PaymentUpdatePayload, select: { email: true }): Promise<UserRecord>;
    updateManyByIdAndSubscription(userId: string, subscriptionId: string, data: object): Promise<{ count: number }>;
    findUniqueById(userId: string): Promise<UserRecord | null>;
    bulkUpdateStatus(userIds: string[], data: object): Promise<{ count: number }>;
    findExpiredSubscriptions(now: Date, limit: number): Promise<{ id: string; email: string }[]>;
}

export class PrismaUserRepository implements IUserRepository {
    constructor(
        private readonly prismaWriter: any,
        private readonly prismaReader: any
    ) {}

    async updateById(userId: string, data: PaymentUpdatePayload, select: { email: true }): Promise<UserRecord> {
        return this.prismaWriter.user.update({
            where: { id: userId },
            data,
            select,
        });
    }

    async updateManyByIdAndSubscription(userId: string, subscriptionId: string, data: object): Promise<{ count: number }> {
        return this.prismaWriter.user.updateMany({
            where: { id: userId, paddleSubscriptionId: subscriptionId },
            data,
        });
    }

    async findUniqueById(userId: string): Promise<UserRecord | null> {
        return this.prismaReader.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
    }

    async bulkUpdateStatus(userIds: string[], data: object): Promise<{ count: number }> {
        return this.prismaWriter.user.updateMany({
            where: { id: { in: userIds } },
            data,
        });
    }

    async findExpiredSubscriptions(now: Date, limit: number): Promise<{ id: string; email: string }[]> {
        return this.prismaReader.user.findMany({
            where: {
                OR: [
                    { paddleSubscriptionStatus: SubscriptionStatus.ACTIVE },
                    { paddleSubscriptionStatus: SubscriptionStatus.TRIALING },
                ],
                subscriptionEndsAt: { lt: now },
            },
            take: limit,
            select: { id: true, email: true },
        });
    }
}
