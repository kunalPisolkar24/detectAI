import { CacheKeys } from "./keys";
import { type RedisClient } from "./RedisClient";
import { Logger } from "../logging/Logger";
import { type MetricsService } from "../monitoring/MetricsService";
import { trace, SpanStatusCode } from "@opentelemetry/api";

export class UserCacheInvalidator {
    constructor(
        private readonly redis: RedisClient,
        private readonly metrics: MetricsService
    ) {}

    async invalidateUser(userId: string, email: string): Promise<void> {
        await this.invalidateUsers([{ id: userId, email }]);
    }

    async invalidateUsers(users: ReadonlyArray<{ id: string; email: string }>): Promise<void> {
        const tracer = trace.getTracer("worker-cache");
        const span = tracer.startSpan("cache.invalidate", { attributes: { keys: users.length * 2 } });
        let invalidateError: unknown = null;
        try {
            const keys = users.flatMap(user => [CacheKeys.user(user.id), CacheKeys.userByEmail(user.email)]);
            if (keys.length === 0) return;

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
                for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
                    const chunk = keys.slice(i, i + CHUNK_SIZE);
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
                this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
                span.setStatus({ code: SpanStatusCode.OK });
            } catch (error) {
                invalidateError = error;
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
