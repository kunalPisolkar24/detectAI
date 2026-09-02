import { createHash } from "crypto";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import type { PaymentEvent } from "../../domain/types";
import { UserNotFoundError, MissingFieldError } from "../../domain/errors";
import { InvalidTransitionError } from "../../domain/stateMachine";
import type { IPaymentEventHandler } from "../handlers/IPaymentEventHandler";
import { type IdempotencyStore } from "@shared/cache/IdempotencyStore";

export class PaymentService {
    private readonly registry: Map<string, IPaymentEventHandler>;

    constructor(
        handlers: Record<string, IPaymentEventHandler>,
        private readonly metrics: MetricsService,
        private readonly idempotencyStore?: IdempotencyStore,
    ) {
        this.registry = new Map(Object.entries(handlers));
    }

    private safeEventType(eventType: string): string {
        return this.registry.has(eventType) ? eventType : "other";
    }

    private resolveEventId(event: PaymentEvent): string {
        const raw = (event as any).event_id ?? (event as any).eventId ?? (event as any).eventId ?? "";
        if (raw && typeof raw === "string" && raw.length > 0) {
            return raw;
        }
        // Fallback for internal events without event_id (e.g., legacy user.cancel_subscription fixtures)
        try {
            const canonical = JSON.stringify(event.data ?? {});
            return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
        } catch {
            return `fallback_${event.event_type}_${Date.now()}`;
        }
    }

    public async handleEvent(event: PaymentEvent): Promise<void> {
        const { event_type, data } = event;
        const jobLabel = this.safeEventType(event_type);
        const userId = data?.custom_data?.userId ?? (data as any).userId ?? null;

        const timer = this.metrics.jobDuration.startTimer({ job_type: jobLabel });
        const eventId = this.resolveEventId(event);

        if (this.idempotencyStore) {
            const isDup = await this.idempotencyStore.isDuplicate(eventId);
            if (isDup) {
                Logger.info("Duplicate Paddle event filtered", { event_id: eventId, event_type });
                try {
                    this.metrics.workerDuplicateEventsTotal.inc({ event_type: jobLabel });
                } catch {}
                try {
                    this.metrics.staleEventsFilteredTotal.inc({ reason: "duplicate" });
                } catch {}
                timer({ status: "duplicate" });
                return;
            }
        }

        const requiresUserId = event_type !== "user.cancel_subscription";
        if (!userId && requiresUserId) {
            Logger.warn("Missing userId for event type", { event_type });
            try {
                this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "missing_userId" });
            } catch {}
            try {
                this.metrics.unhandledEventsTotal.inc({ event_type: jobLabel });
            } catch {}
            timer({ status: "ignored" });
            return;
        }

        const handler = this.registry.get(event_type);
        if (!handler) {
            Logger.warn("No handler registered for event type", { event_type });
            this.metrics.unhandledEventsTotal.inc({ event_type: jobLabel });
            timer({ status: "unhandled" });
            return;
        }

        if (!event.occurred_at) {
            Logger.warn("Event missing occurred_at, using server timestamp", { event_type, userId });
        }
        data.occurred_at = event.occurred_at ?? new Date().toISOString();

        this.metrics.activeJobs.inc({ job_type: jobLabel });
        try {
            await handler.handle(userId, data);
            this.metrics.jobTotal.inc({ job_type: jobLabel });
            timer({ status: "success" });
            if (this.idempotencyStore) {
                await this.idempotencyStore.markProcessed(eventId, event_type);
            }
        } catch (error) {
            if (error instanceof UserNotFoundError) {
                Logger.warn("Webhook arrived before user row exists; sending to DLQ", {
                    event_type,
                    userId: error.identifier,
                });
                this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "user_not_found" });
                timer({ status: "dlq" });
                throw error;
            }
            if (error instanceof MissingFieldError) {
                Logger.warn("Missing required field, sending to DLQ", { field: error.field, event_type, userId });
                try {
                    this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: `missing_${error.field}` });
                } catch {}
                try {
                    this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "missing_field" });
                } catch {}
                timer({ status: "dlq" });
                throw error;
            }

            Logger.error("Error processing payment event", error, { event_type, userId });
            this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "process_failure" });
            timer({ status: "error" });
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: jobLabel });
        }
    }
}
