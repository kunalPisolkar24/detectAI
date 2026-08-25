import { SubscriptionStatus, type PrismaClient } from "../../../../../generated/prisma/client";
import { type IUserRepository, type TransitionValidator } from "../../domain/IUserRepository";
import {
    type BulkSubscriptionUpdate,
    type ExpiredSubscription,
    type SubscriptionUpdateData,
    type SubscriptionUpdateResult,
    type UserRecord,
} from "../../domain/types";

type PrismaTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export class PrismaUserRepository implements IUserRepository {
    constructor(
        private readonly prismaWriter: PrismaClient,
        private readonly prismaReader: PrismaClient,
        private readonly validateStatusTransition: TransitionValidator = () => {}
    ) {}

    async findUniqueById(userId: string): Promise<UserRecord | null> {
        return this.prismaReader.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
    }

    async expireDueSubscriptions(limit: number, data: BulkSubscriptionUpdate): Promise<ExpiredSubscription[]> {
        return this.prismaWriter.$transaction(async (tx: PrismaTransaction) => {
            const users = await tx.$queryRawUnsafe<ExpiredSubscription[]>(
                `SELECT u.id, u.email FROM "User" u INNER JOIN "Subscription" s ON s."userId" = u.id WHERE s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE') AND s."endsAt" < NOW() ORDER BY s."endsAt" ASC LIMIT $1 FOR UPDATE OF s SKIP LOCKED`,
                limit,
            );
            if (users.length === 0) return [];

            await tx.subscription.updateMany({
                where: {
                    userId: { in: users.map(user => user.id) },
                    status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
                    endsAt: { lt: new Date() },
                },
                data,
            });

            return users;
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

    async lockAndUpdateSubscription(
        userId: string,
        eventTimestamp: Date,
        status: SubscriptionStatus,
        payload: SubscriptionUpdateData,
        paddleCustomerId?: string
    ): Promise<SubscriptionUpdateResult> {
        return this.prismaWriter.$transaction(async (tx: PrismaTransaction) => {
            const rows = await tx.$queryRawUnsafe<Array<{ eventTimestamp: Date | null; status: string }>>(
                `SELECT s."eventTimestamp", s.status FROM "Subscription" s WHERE s."userId" = $1 FOR UPDATE`,
                userId,
            );
            const currentRow = rows[0];

            if (currentRow) {
                if (currentRow.eventTimestamp && eventTimestamp <= currentRow.eventTimestamp) {
                    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
                    return user ? { email: user.email, stale: true } : { email: "", stale: true };
                }
                this.validateStatusTransition(currentRow.status as SubscriptionStatus, status);
            } else {
                this.validateStatusTransition(null, status);
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
            if (!user) return { email: "", stale: false };
            return { email: user.email, stale: false };
        });
    }
}
