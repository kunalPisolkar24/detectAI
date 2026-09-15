import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { trace, SpanStatusCode } from "@opentelemetry/api";

/**
 * Safety-net reset for `Usage.apiCallCountDaily`.
 *
 * The hot path (`incrementUsage`) already rolls the counter atomically on UTC
 * day change, so this job normally resets zero rows. It covers rows the hot
 * path never touches (no events today, or rows predating the atomic reset).
 * Idempotent and cheap when there is nothing stale; runs at most once per
 * `minIntervalMs` to avoid a sequential scan on every sweep pass.
 */
export class UsageResetter {
    private lastRunAt: number | null = null;

    constructor(
        private readonly userRepository: IUserRepository,
        private readonly metrics: MetricsService,
        private readonly minIntervalMs = 60 * 60 * 1000
    ) {}

    public async resetIfDue(now: number = Date.now()): Promise<number> {
        if (this.lastRunAt !== null && now - this.lastRunAt < this.minIntervalMs) return 0;
        this.lastRunAt = now;

        const tracer = trace.getTracer("worker-cron");
        const span = tracer.startSpan("usage_reset");
        const timer = this.metrics.jobDuration.startTimer({ job_type: "usage_reset" });
        this.metrics.activeJobs.inc({ job_type: "usage_reset" });
        try {
            const reset = await this.userRepository.resetStaleDailyUsage();
            if (reset > 0) {
                Logger.info(`Usage daily reset cleared ${reset} stale rows`);
            }
            this.metrics.jobTotal.inc({ job_type: "usage_reset" });
            span.setAttribute("result.count", reset);
            span.setStatus({ code: SpanStatusCode.OK });
            timer({ status: "success" });
            return reset;
        } catch (error) {
            timer({ status: "error" });
            try { span.recordException(error as Error); span.setStatus({ code: SpanStatusCode.ERROR }); } catch {}
            try { this.metrics.jobErrors.inc({ job_type: "usage_reset", error_type: "db_error" }); } catch {}
            Logger.error("Usage daily reset failed", error as any);
            // Reset the guard so the next loop retries rather than waiting an hour.
            this.lastRunAt = null;
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: "usage_reset" });
            try { span.end(); } catch {}
        }
    }
}
