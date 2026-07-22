import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type PaymentUpdatePayload } from "@modules/payments/domain/types";

export interface UserRecord {
    email: string;
}

export interface IUserRepository {
    updateById(userId: string, data: PaymentUpdatePayload, select: { email: true }): Promise<UserRecord>;
    updateManyByIdAndSubscription(userId: string, subscriptionId: string, data: object): Promise<{ count: number }>;
    findUniqueById(userId: string): Promise<UserRecord | null>;
    bulkUpdateStatus(userIds: string[], data: object): Promise<{ count: number }>;
    findExpiredSubscriptions(now: Date, limit: number): Promise<{ id: string; email: string }[]>;
    findExpiredSubscriptionsWithLock(limit: number): Promise<{ id: string; email: string }[]>;
    incrementUsage(userId: string, count: number): Promise<void>;
}

export class PrismaUserRepository implements IUserRepository {
    constructor(
        private readonly prismaWriter: any,
        private readonly prismaReader: any
    ) {}

    async updateById(userId: string, data: PaymentUpdatePayload, select: { email: true }): Promise<UserRecord> {
        return this.prismaWriter.user.update({
            where: { id: userId },
            data: {
                paddleCustomerId: data.paddleCustomerId,
                subscription: {
                    upsert: {
                        create: {
                            paddleSubscriptionId: data.paddleSubscriptionId,
                            paddlePlanId: data.paddlePlanId,
                            status: data.status,
                            endsAt: data.endsAt,
                            cancellationScheduled: data.cancellationScheduled ?? false,
                        },
                        update: {
                            paddleSubscriptionId: data.paddleSubscriptionId,
                            paddlePlanId: data.paddlePlanId,
                            status: data.status,
                            endsAt: data.endsAt,
                            cancellationScheduled: data.cancellationScheduled ?? false,
                        }
                    }
                }
            },
            select,
        });
    }

    async updateManyByIdAndSubscription(userId: string, subscriptionId: string, data: object): Promise<{ count: number }> {
        return this.prismaWriter.subscription.updateMany({
            where: { userId, paddleSubscriptionId: subscriptionId },
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
        return this.prismaWriter.subscription.updateMany({
            where: {
                userId: { in: userIds },
                status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
                endsAt: { lt: new Date() },
            },
            data,
        });
    }

    async findExpiredSubscriptions(now: Date, limit: number): Promise<{ id: string; email: string }[]> {
        const subscriptions = await this.prismaWriter.subscription.findMany({
            where: {
                OR: [
                    { status: SubscriptionStatus.ACTIVE },
                    { status: SubscriptionStatus.TRIALING },
                ],
                endsAt: { lt: now },
            },
            take: limit,
            select: { 
                user: {
                    select: { id: true, email: true }
                }
            },
        });

        return subscriptions.map((s: any) => s.user);
    }

    async findExpiredSubscriptionsWithLock(limit: number): Promise<{ id: string; email: string }[]> {
        const rows = await this.prismaWriter.$queryRawUnsafe<Array<{ id: string; email: string }>>(
            `SELECT u.id, u.email FROM "User" u INNER JOIN "Subscription" s ON s."userId" = u.id WHERE s.status IN ('ACTIVE', 'TRIALING') AND s."endsAt" < NOW() ORDER BY s."endsAt" ASC LIMIT $1 FOR UPDATE OF s SKIP LOCKED`,
            limit,
        );
        return rows;
    }

    async incrementUsage(userId: string, count: number): Promise<void> {
        await this.prismaWriter.$executeRaw`
            INSERT INTO "Usage" ("id", "userId", "apiCallCountTotal", "apiCallCountDaily", "lastApiCallReset", "updatedAt", "createdAt")
            VALUES (gen_random_uuid(), ${userId}, ${count}, ${count}, NOW(), NOW(), NOW())
            ON CONFLICT ("userId") DO UPDATE SET
                "apiCallCountTotal" = "Usage"."apiCallCountTotal" + ${count},
                "apiCallCountDaily" = "Usage"."apiCallCountDaily" + ${count},
                "lastApiCallReset" = NOW(),
                "updatedAt" = NOW()
        `;
    }
}
