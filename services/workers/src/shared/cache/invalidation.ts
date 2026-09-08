import { CacheKeys } from "./keys";
import { type RedisClient } from "./RedisClient";
import { Logger } from "../logging/Logger";
import { type MetricsService } from "../monitoring/MetricsService";
import { trace, SpanStatusCode } from "@opentelemetry/api";

/**
 * Split invalidation for the post-split cache layout (`redis-cache`):
 * - basic profile (`user:basic:*`) — web profile updates only
 * - subscription (`user:sub:*`)   — payment webhooks/sweeper only
 * - usage counters (`rate_limit:*`) are NEVER deleted (TTL expiry only)
 * - analytics dedup (`analytics:usage:event:*`) is NEVER deleted except TTL
 *
 * Usage tracking (async worker or sync fallback) must NOT invalidate user
 * cache — the cached rows no longer embed usage counters.
 */
export class UserCacheInvalidator {
    constructor(
        private readonly redis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    /** Profile invalidation (web profile updates). */
    async invalidateBasic(userId: string, email: string): Promise<void> {
        await this.invalidateKeys([
            CacheKeys.userBasic(userId),
            CacheKeys.userBasicByEmail(email),
            ...this.legacyKeys(userId, email),
        ]);
    }

    /** Subscription invalidation (payment webhooks / sweeper). */
    async invalidateSubscription(userId: string): Promise<void> {
        await this.invalidateKeys([CacheKeys.userSub(userId)]);
    }

    /**
     * Full user invalidation (basic + subscription + legacy).
     * Payment handlers and sweeper use this; usage tracking must NOT.
     */
    async invalidateUser(userId: string, email: string): Promise<void> {
        await this.invalidateUsers([{ id: userId, email }]);
    }

    async invalidateUsers(users: ReadonlyArray<{ id: string; email: string }>): Promise<void> {
        const keys = users.flatMap((user) => [
            CacheKeys.userBasic(user.id),
            CacheKeys.userBasicByEmail(user.email),
            CacheKeys.userSub(user.id),
            ...this.legacyKeys(user.id, user.email),
        ]);
        await this.invalidateKeys(keys);
    }

    async invalidateSubscriptions(userIds: ReadonlyArray<string>): Promise<void> {
        await this.invalidateKeys(userIds.map((id) => CacheKeys.userSub(id)));
    }

    private legacyKeys(userId: string, email: string): string[] {
        return [
            CacheKeys.legacy.webUser(userId),
            CacheKeys.legacy.webUserByEmail(email),
            CacheKeys.legacy.workerUser(userId),
            CacheKeys.legacy.workerUserByEmail(email),
            // Pre-split canonical aliases (remove after one release).
            CacheKeys.user(userId),
            CacheKeys.userByEmail(email),
        ];
    }

    private async invalidateKeys(keys: string[]): Promise<void> {
        const uniq = [...new Set(keys.filter(Boolean))];
        if (uniq.length === 0) return;
        const tracer = trace.getTracer("worker-cache");
        const span = tracer.startSpan("cache.invalidate", { attributes: { keys: uniq.length } });
        try {
            // Chunk to avoid blocking Redis and to handle CROSSSLOT on cluster (pipeline per key)
            const CHUNK_SIZE = 100;
            const pipelineDelete = async (keyChunk: string[]) => {
                // Prefer pipeline/unlink for cluster safety; fallback to single DEL
                const maybePipeline = (this.redis as any).pipeline;
                if (typeof maybePipeline === "function") {
                    const pipe = (this.redis as any).pipeline();
                    for (const k of keyChunk) {
                        // Use unlink if available (non-blocking), otherwise del
                        if (typeof pipe.unlink === "function") pipe.unlink(k);
                        else pipe.del(k);
                    }
                    await pipe.exec();
                } else {
                    // Cluster without pipeline fallback: per-key del
                    for (const k of keyChunk) {
                        try {
                            if (typeof (this.redis as any).unlink === "function") await (this.redis as any).unlink(k);
                            else await this.redis.del(k);
                        } catch {}
                    }
                }
            };

            const execute = async () => {
                for (let i = 0; i < uniq.length; i += CHUNK_SIZE) {
                    const chunk = uniq.slice(i, i + CHUNK_SIZE);
                    await pipelineDelete(chunk);
                }
            };

            try {
                let durationTimer = this.metrics.cacheInvalidateDurationSeconds.startTimer({ attempt: "1" });
                try {
                    await execute();
                    durationTimer();
                } catch (firstError) {
                    durationTimer();
                    try { this.metrics.cacheInvalidateRetriesTotal.inc(); } catch {}
                    await new Promise(resolve => setTimeout(resolve, 50));
                    durationTimer = this.metrics.cacheInvalidateDurationSeconds.startTimer({ attempt: "2" });
                    try {
                        await execute();
                        durationTimer();
                    } catch (retryError) {
                        durationTimer();
                        throw retryError;
                    }
                }
                this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, uniq.length);
                span.setStatus({ code: SpanStatusCode.OK });
            } catch (error) {
                try { span.recordException(error as Error); span.setStatus({ code: SpanStatusCode.ERROR }); } catch {}
                Logger.error("Failed to invalidate user cache after retry", error as any);
                try { this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "redis_error" }); } catch {}
                // Do not throw by default to avoid failing the DB transaction on cache-only failure.
                // Callers that require strict invalidation should check metrics or handle this via DLQ alerting.
                // We log and metric, but swallow to preserve transaction success (post-commit invalidation is best-effort).
            }
        } finally {
            try { span.end(); } catch {}
        }
    }
}
