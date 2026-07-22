import { Logger } from "@shared/logging/Logger";
import { MetricsService } from "@shared/monitoring/MetricsService";
import type { PaymentEvent } from "../../domain/types";
import type { IPaymentEventHandler } from "../handlers/IPaymentEventHandler";

export class PaymentService {
    private readonly registry: Map<string, IPaymentEventHandler>;

    constructor(
        handlers: Record<string, IPaymentEventHandler>,
        private readonly metrics: MetricsService
    ) {
        this.registry = new Map(Object.entries(handlers));
    }

    public async handleEvent(event: PaymentEvent): Promise<void> {
        const { event_type, data } = event;
        const userId = data?.custom_data?.userId ?? (data as any).userId ?? null;

        const timer = this.metrics.jobDuration.startTimer({ job_type: event_type });

        const requiresUserId = event_type !== "user.cancel_subscription";
        if (!userId && requiresUserId) {
            timer({ status: "ignored" });
            return;
        }

        const handler = this.registry.get(event_type);
        if (!handler) {
            Logger.warn("No handler registered for event type", { event_type });
            timer({ status: "ignored" });
            return;
        }

        const occurredAt = (event as any).occurred_at ?? new Date().toISOString();
        data.occurred_at = occurredAt;

        this.metrics.activeJobs.inc({ job_type: event_type });
        try {
            await handler.handle(userId, data);
            this.metrics.jobTotal.inc({ job_type: event_type });
            timer({ status: "success" });
        } catch (error) {
            Logger.error("Error processing payment event", error, { event_type, userId });
            this.metrics.jobErrors.inc({ job_type: event_type, error_type: "process_failure" });
            timer({ status: "error" });
            throw error;
        } finally {
            this.metrics.activeJobs.dec({ job_type: event_type });
        }
    }
}