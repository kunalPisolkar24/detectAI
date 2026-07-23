import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type PaymentUpdatePayload } from "@modules/payments/domain/types";
import { validateTransition } from "@modules/payments/domain/stateMachine";

export interface UserRecord {
    email: string;
}

export interface IUserRepository {
    findUniqueById(userId: string): Promise<UserRecord | null>;
    bulkUpdateStatus(userIds: string[], data: object): Promise<{ count: number }>;
    findExpiredSubscriptionsWithLock(limit: number): Promise<{ id: string; email: string }[]>;
    incrementUsage(userId: string, count: number): Promise<void>;
    lockAndUpdateSubscription(
        userId: string,
        eventTimestamp: Date,
        status: SubscriptionStatus,
        payload: PaymentUpdatePayload,
        paddleCustomerId?: string
    ): Promise<{ email: string; stale: boolean }>;
}

export class PrismaUserRepository implements IUserRepository {
    constructor(
        private readonly prismaWriter: any,
        private readonly prismaReader: any
    ) {}

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

    async findExpiredSubscriptionsWithLock(limit: number): Promise<{ id: string; email: string }[]> {
        const rows = await this.prismaWriter.$queryRawUnsafe<Array<{ id: string; email: string }>>(
            `SELECT u.id, u.email FROM "User" u INNER JOIN "Subscription" s ON s."userId" = u.id WHERE s.status IN ('ACTIVE', 'TRIALING') AND s."endsAt" < NOW() ORDER BY s."endsAt" ASC LIMIT $1 FOR UPDATE OF s SKIP LOCKED`,
            limit,
        );
        return rows;
    }

    async lockAndUpdateSubscription(
        userId: string,
        eventTimestamp: Date,
        status: SubscriptionStatus,
        payload: PaymentUpdatePayload,
        paddleCustomerId?: string
    ): Promise<{ email: string; stale: boolean }> {
        return this.prismaWriter.$transaction(async (tx: any) => {
            const rows = (await tx.$queryRawUnsafe(
                `SELECT s."eventTimestamp", s.status FROM "Subscription" s WHERE s."userId" = $1 FOR UPDATE`,
                userId,
            )) as Array<{ eventTimestamp: Date | null; status: string | null }>;

            if (rows.length > 0) {
                const stored = rows[0]!;
                if (stored.eventTimestamp && eventTimestamp <= stored.eventTimestamp) {
                    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
                    return { email: user!.email, stale: true };
                }
                validateTransition(stored.status as SubscriptionStatus | null, status);
            } else {
                validateTransition(null, status);
            }

            if (paddleCustomerId) {
                await tx.user.update({
                    where: { id: userId },
                    data: { paddleCustomerId },
                });
            }

            await tx.subscription.upsert({
                where: { userId },
                create: {
                    userId,
                    paddleSubscriptionId: payload.paddleSubscriptionId,
                    paddlePlanId: payload.paddlePlanId,
                    status: payload.status,
                    endsAt: payload.endsAt,
                    cancellationScheduled: payload.cancellationScheduled ?? false,
                    eventTimestamp,
                },
                update: {
                    paddleSubscriptionId: payload.paddleSubscriptionId,
                    paddlePlanId: payload.paddlePlanId,
                    status: payload.status,
                    endsAt: payload.endsAt,
                    cancellationScheduled: payload.cancellationScheduled ?? false,
                    eventTimestamp,
                },
            });

            const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
            return { email: user!.email, stale: false };
        });
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
