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

    async invalidateUser(userId: string, email: string): Promise<void> {
        await this.invalidateUsers([{ id: userId, email }]);
    }

    async invalidateUsers(users: ReadonlyArray<{ id: string; email: string }>): Promise<void> {
        const keys = users.flatMap((user) => [
            CacheKeys.userBasic(user.id),
            CacheKeys.userBasicByEmail(user.email),
            CacheKeys.userSub(user.id),
        ]);
        await this.invalidateKeys(keys);
    }

    private async invalidateKeys(keys: string[]): Promise<void> {
        const uniq = [...new Set(keys.filter(Boolean))];
        if (uniq.length === 0) return;
        const tracer = trace.getTracer("worker-cache");
        const span = tracer.startSpan("cache.invalidate", { attributes: { keys: uniq.length } });
        try {
            const CHUNK_SIZE = 100;
            const pipelineDelete = async (keyChunk: string[]) => {
                const maybePipeline = (this.redis as any).pipeline;
                if (typeof maybePipeline === "function") {
                    const pipe = (this.redis as any).pipeline();
                    for (const k of keyChunk) {
                        if (typeof pipe.unlink === "function") pipe.unlink(k);
                        else pipe.del(k);
                    }
                    await pipe.exec();
                } else {
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
            }
        } finally {
            try { span.end(); } catch {}
        }
    }
}
