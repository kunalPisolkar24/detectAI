import { createHash } from "crypto";
import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import type { PaymentEvent } from "../../domain/types";
import { UserNotFoundError, MissingFieldError } from "../../domain/errors";
import { InvalidTransitionError } from "../../domain/stateMachine";
import type { IPaymentEventHandler } from "../handlers/IPaymentEventHandler";
import { type IdempotencyStore } from "@shared/cache/IdempotencyStore";

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

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
        const raw =
            (event as any).event_id ??
            (event as any).eventId ??
            (event as any).notification_id ??
            (event as any).notificationId ??
            "";
        if (raw && typeof raw === "string" && raw.length > 0) {
            return raw;
        }
        // Fallback for internal events without event_id: stable hash of event_type + data (sorted keys)
        try {
            const canonical = stableStringify({ event_type: event.event_type, data: event.data ?? {} });
            return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
        } catch {
            return `fallback_${event.event_type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
    }

    private isRetryableError(error: unknown): boolean {
        if (error instanceof UserNotFoundError) return false;
        if (error instanceof MissingFieldError) return false;
        if (error instanceof InvalidTransitionError) return false;
        const name = (error as any)?.name;
        if (name === "UserNotFoundError" || name === "MissingFieldError" || name === "InvalidTransitionError") return false;
        return true;
    }

    public async handleEvent(event: PaymentEvent): Promise<void> {
        const { event_type, data } = event;
        const jobLabel = this.safeEventType(event_type);
        const userId = data?.custom_data?.userId ?? (data as any).userId ?? null;

        const timer = this.metrics.jobDuration.startTimer({ job_type: jobLabel });
        const eventId = this.resolveEventId(event);

        // Validate before claiming to avoid leaking idempotency claim for poison messages
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
            throw new MissingFieldError("userId");
        }

        const handler = this.registry.get(event_type);
        if (!handler) {
            Logger.warn("No handler registered for event type", { event_type });
            try {
                this.metrics.unhandledEventsTotal.inc({ event_type: jobLabel });
            } catch {}
            timer({ status: "unhandled" });
            // For unhandled types, mark as processed to allow future handler rollout to reprocess via DB replay window
            // But also throw to route to DLQ for visibility
            return;
        }

        if (!event.occurred_at) {
            Logger.warn("Event missing occurred_at, using server timestamp", { event_type, userId });
        }
        // Do not mutate original event data; handlers parse occurred_at themselves with strict validation
        const effectiveOccurredAt = event.occurred_at ?? new Date().toISOString();
        // Ensure data has occurred_at for handlers that read it, but clone-safe
        if (data && typeof data === "object" && !data.occurred_at) {
            (data as any).occurred_at = effectiveOccurredAt;
        }

        // Claim idempotency AFTER validation
        let claimed = false;
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
            claimed = true;
        }

        this.metrics.activeJobs.inc({ job_type: jobLabel });
        try {
            await handler.handle(userId, data);
            this.metrics.jobTotal.inc({ job_type: jobLabel });
            timer({ status: "success" });
            if (this.idempotencyStore) {
                await this.idempotencyStore.markProcessed(eventId, event_type);
            }
        } catch (error) {
            // Release claim for retryable errors so redelivery can succeed
            if (claimed && this.isRetryableError(error)) {
                try {
                    await this.idempotencyStore?.release(eventId);
                } catch {}
            }

            if (error instanceof UserNotFoundError) {
                Logger.warn("Webhook arrived before user row exists; sending to DLQ", {
                    event_type,
                    userId: error.identifier,
                });
                try { this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "user_not_found" }); } catch {}
                timer({ status: "dlq" });
                throw error;
            }
            if (error instanceof MissingFieldError) {
                Logger.warn("Missing required field, sending to DLQ", { field: error.field, event_type, userId });
                try {
                    this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: `missing_${error.field}` });
                } catch {}
                // Single inc with field label — avoid double counting
                timer({ status: "dlq" });
                throw error;
            }
            if (error instanceof InvalidTransitionError) {
                Logger.warn("Invalid transition, sending to DLQ", { from: error.from, to: error.to, event_type, userId });
                try { this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "invalid_transition" }); } catch {}
                timer({ status: "dlq" });
                throw error;
            }
            // Check by name for JSON-serialized errors
            const name = (error as any)?.name;
            if (name === "UserNotFoundError" || name === "MissingFieldError" || name === "InvalidTransitionError") {
                timer({ status: "dlq" });
                throw error;
            }

            Logger.error("Error processing payment event", error as any, { event_type, userId });
            try { this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "process_failure" }); } catch {}
            timer({ status: "error" });
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: jobLabel });
        }
    }
}
