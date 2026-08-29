import { SubscriptionStatus, type PrismaClient } from "../../../../../generated/prisma/client";
import { type IUserRepository, type TransitionValidator } from "../../domain/IUserRepository";
import {
    type BulkSubscriptionUpdate,
    type ExpiredSubscription,
    type SubscriptionUpdateData,
    type SubscriptionUpdateResult,
    type UserRecord,
} from "../../domain/types";
import { type MetricsService } from "@shared/monitoring/MetricsService";

type PrismaTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export class PrismaUserRepository implements IUserRepository {
    constructor(
        private readonly prismaWriter: PrismaClient,
        private readonly prismaReader: PrismaClient,
        private readonly validateStatusTransition: TransitionValidator = () => {},
        private readonly metrics?: MetricsService
    ) {}

    async findUniqueById(userId: string): Promise<UserRecord | null> {
        return this.prismaReader.user.findUnique({
            where: { id: userId },
            select: { email: true },
        });
    }

    async expireDueSubscriptions(
        limit: number,
        data: BulkSubscriptionUpdate,
        sweepTime: Date,
        onSelected?: (users: ExpiredSubscription[]) => Promise<void>
    ): Promise<ExpiredSubscription[]> {
        const txTimer = this.metrics?.dbTransactionDurationSeconds.startTimer();
        let txResult: "committed" | "rolled_back" = "committed";
        try {
            return await this.prismaWriter.$transaction(async (tx: PrismaTransaction) => {
            // NULL status = never billable, never swept (data-hygiene guard, see #189).
            // NULL endsAt = lifetime subscription, never swept (see #198).
            // Audit queries for prod replicas live in docs/sweep-null-audit.sql.
            const users = await tx.$queryRawUnsafe<ExpiredSubscription[]>(
                `SELECT u.id, u.email, s."paddleSubscriptionId", s."endsAt" FROM "User" u INNER JOIN "Subscription" s ON s."userId" = u.id
                 WHERE s.status IS NOT NULL AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED')
                   AND s."endsAt" IS NOT NULL AND s."endsAt" < $2
                 ORDER BY s."endsAt" ASC LIMIT $1 FOR UPDATE OF s SKIP LOCKED`,
                limit,
                sweepTime,
            );
            if (this.metrics) {
                this.metrics.sweepBatchSize.observe({ stage: "selected" }, users.length);
            }
            if (users.length === 0) return [];

            if (onSelected) {
                await onSelected(users);
            }

            const result = await tx.subscription.updateMany({
                where: {
                    userId: { in: users.map(user => user.id) },
                    status: {
                        in: [
                            SubscriptionStatus.ACTIVE,
                            SubscriptionStatus.TRIALING,
                            SubscriptionStatus.PAST_DUE,
                            SubscriptionStatus.PAUSED,
                        ],
                    },
                    endsAt: { lt: sweepTime },
                },
                data: {
                    ...data,
                    eventTimestamp: data.eventTimestamp ?? sweepTime,
                },
            });

            if (this.metrics) {
                this.metrics.sweepBatchSize.observe({ stage: "updated" }, result.count);
                const filtered = users.length - result.count;
                if (filtered > 0) {
                    this.metrics.staleEventsFilteredTotal.inc({ reason: "phantom_select" }, filtered);
                }
                // SKIP LOCKED pressure: when selected < limit but update count < selected, or selected < limit indicates locks held
                if (users.length > 0 && users.length < limit) {
                    const skipped = limit - users.length;
                    // Best-effort: partial fill may be due to locks or simply not enough rows; still valuable as contention signal
                    try { this.metrics.dbLockSkippedTotal.inc(skipped); } catch {}
                } else if (filtered > 0) {
                    // phantom filtered also indicates clock drift / concurrent mutation contention
                    try { this.metrics.dbLockSkippedTotal.inc(filtered); } catch {}
                }
            }

            return users.slice(0, result.count);
        });
        } catch (error) {
            txResult = "rolled_back";
            throw error;
        } finally {
            try { txTimer?.({ result: txResult }); } catch {}
        }
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
                if (currentRow.eventTimestamp !== null && eventTimestamp <= currentRow.eventTimestamp) {
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
