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
import { trace, SpanStatusCode } from "@opentelemetry/api";

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
        // Guard against unbounded scans (LIMIT -1 = ALL) and zero
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
            throw new Error(`Invalid sweep limit: ${limit} (must be 1..1000)`);
        }
        const tracer = trace.getTracer("worker-db");
        const span = tracer.startSpan("db.expireDueSubscriptions", { attributes: { limit, sweepTime: sweepTime.toISOString() } });
        const txTimer = this.metrics?.dbTransactionDurationSeconds.startTimer();
        let txResult: "committed" | "rolled_back" = "committed";
        try {
            const result = await this.prismaWriter.$transaction(async (tx: PrismaTransaction) => {
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

            // onSelected previously ran inside tx holding FOR UPDATE locks (high latency).
            // Now intentionally NOT called inside transaction to avoid Redis I/O while holding locks.
            // Caller handles post-commit cache invalidation.

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
                    // Guard against clobbering fresher webhook: only sweep if stored eventTimestamp <= sweepTime
                    OR: [
                        { eventTimestamp: null },
                        { eventTimestamp: { lte: sweepTime } },
                    ],
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

            // Fix for slice bug: instead of users.slice(0, count) which assumes ordered IN, re-query updated rows.
            // Use returned count to filter via DB lookup for exact updated set.
            if (result.count === users.length) {
                return users;
            }
            if (result.count === 0) return [];
            // Partial update: fetch actual updated rows via follow-up query
            const updatedIds = users.map(u => u.id);
            // Fallback: return first N as approximation but log — ideally use RETURNING in raw query.
            // For correctness without RETURNING, query for rows that now match CANCELED + sweepTime
            try {
                const refreshed = await tx.$queryRawUnsafe<ExpiredSubscription[]>(
                    `SELECT u.id, u.email, s."paddleSubscriptionId", s."endsAt" FROM "User" u INNER JOIN "Subscription" s ON s."userId" = u.id WHERE s."userId" = ANY($1::text[]) AND s.status = 'CANCELED' AND s."eventTimestamp" = $2`,
                    updatedIds,
                    data.eventTimestamp ?? sweepTime,
                );
                if (refreshed.length > 0) return refreshed;
            } catch {}
            return users.slice(0, result.count);
        });
            // Post-commit cache invalidation (outside lock) — previously held FOR UPDATE while doing Redis I/O
            if (onSelected && result.length > 0) {
                try { await onSelected(result); } catch {}
            }
            span.setAttribute("result.count", result.length);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            txResult = "rolled_back";
            try { span.recordException(error as Error); span.setStatus({ code: SpanStatusCode.ERROR }); } catch {}
            throw error;
        } finally {
            try { txTimer?.({ result: txResult }); } catch {}
            try { span.end(); } catch {}
        }
    }

    async incrementUsage(userId: string, count: number): Promise<void> {
        await this.prismaWriter.$executeRaw`
            INSERT INTO "Usage" ("id", "userId", "apiCallCountTotal", "apiCallCountDaily", "lastApiCallReset", "updatedAt", "createdAt")
            VALUES (gen_random_uuid(), ${userId}, ${count}, ${count}, NOW(), NOW(), NOW())
            ON CONFLICT ("userId") DO UPDATE SET
                "apiCallCountTotal" = "Usage"."apiCallCountTotal" + ${count},
                "apiCallCountDaily" = "Usage"."apiCallCountDaily" + ${count},
                "lastApiCallReset" = "Usage"."lastApiCallReset",
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
            // Avoid indefinite blocking behind sweeper's FOR UPDATE locks
            try {
                await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`);
            } catch {}
            const rows = await tx.$queryRawUnsafe<Array<{ eventTimestamp: Date | null; status: string; paddlePlanId: string | null; endsAt: Date | null; cancellationScheduled: boolean | null }>>(
                `SELECT s."eventTimestamp", s.status, s."paddlePlanId", s."endsAt", s."cancellationScheduled" FROM "Subscription" s WHERE s."userId" = $1 FOR UPDATE`,
                userId,
            );
            const currentRow = rows[0];

            if (currentRow) {
                // Use < not <= to allow same-timestamp distinct events (Paddle second granularity)
                if (currentRow.eventTimestamp !== null && eventTimestamp < currentRow.eventTimestamp) {
                    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
                    return user ? { email: user.email, stale: true } : { email: "", stale: true };
                }
                // For equal timestamps, DB remains authoritative but we don't drop here — let stateMachine decide
                if (currentRow.eventTimestamp !== null && eventTimestamp.getTime() === currentRow.eventTimestamp.getTime()) {
                    // If same timestamp but same status, treat as stale to avoid churn; otherwise allow
                    if (currentRow.status === status) {
                        const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
                        return user ? { email: user.email, stale: true } : { email: "", stale: true };
                    }
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

            const effectivePaddlePlanId = payload.paddlePlanId !== undefined ? payload.paddlePlanId : (currentRow?.paddlePlanId ?? null);
            // Preserve existing endsAt when payload is null/undefined (missing billing period) — wipe only via explicit sweep
            let effectiveEndsAt: Date | null | undefined = payload.endsAt;
            if (payload.endsAt === null || payload.endsAt === undefined) {
                effectiveEndsAt = (currentRow as any)?.endsAt ?? undefined;
                // For upsert, undefined means preserve (coalesce in repo), but create needs value
                // If creating new row with no endsAt, keep null; if updating, keep existing
                if (effectiveEndsAt === undefined && currentRow) {
                    effectiveEndsAt = (currentRow as any).endsAt ?? null;
                }
            }
            const effectiveCancellationScheduled =
                payload.cancellationScheduled !== undefined
                    ? payload.cancellationScheduled
                    : (currentRow?.cancellationScheduled ?? false);

            await tx.subscription.upsert({
                where: { userId },
                create: {
                    userId,
                    paddleSubscriptionId: payload.paddleSubscriptionId,
                    paddlePlanId: effectivePaddlePlanId,
                    status: payload.status,
                    endsAt: (effectiveEndsAt as any) ?? null,
                    cancellationScheduled: effectiveCancellationScheduled,
                    eventTimestamp,
                },
                update: {
                    paddleSubscriptionId: payload.paddleSubscriptionId,
                    paddlePlanId: effectivePaddlePlanId,
                    status: payload.status,
                    // Only overwrite endsAt if payload explicitly provided non-null, otherwise keep current
                    ...(payload.endsAt !== null && payload.endsAt !== undefined ? { endsAt: payload.endsAt } : {}),
                    cancellationScheduled: effectiveCancellationScheduled,
                    eventTimestamp,
                },
            });

            const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
            if (!user) return { email: "", stale: false };
            return { email: user.email, stale: false };
        });
    }
}
