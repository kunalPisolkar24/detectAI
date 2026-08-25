import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import type { PaymentEvent } from "../../domain/types";
import { UserNotFoundError } from "../../domain/errors";
import type { IPaymentEventHandler } from "../handlers/IPaymentEventHandler";

export class PaymentService {
    private readonly registry: Map<string, IPaymentEventHandler>;

    constructor(
        handlers: Record<string, IPaymentEventHandler>,
        private readonly metrics: MetricsService
    ) {
        this.registry = new Map(Object.entries(handlers));
    }

    private safeEventType(eventType: string): string {
        return this.registry.has(eventType) ? eventType : "other";
    }

    public async handleEvent(event: PaymentEvent): Promise<void> {
        const { event_type, data } = event;
        const jobLabel = this.safeEventType(event_type);
        const userId = data?.custom_data?.userId ?? (data as any).userId ?? null;

        const timer = this.metrics.jobDuration.startTimer({ job_type: jobLabel });

        const requiresUserId = event_type !== "user.cancel_subscription";
        if (!userId && requiresUserId) {
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

            Logger.error("Error processing payment event", error, { event_type, userId });
            this.metrics.jobErrors.inc({ job_type: jobLabel, error_type: "process_failure" });
            timer({ status: "error" });
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: jobLabel });
        }
    }
}
