import { Logger } from "@shared/logging/Logger";
import { type MetricsService } from "@shared/monitoring/MetricsService";

export interface IPaddleClient {
    cancelSubscription(subscriptionId: string): Promise<void>;
}

export class PaddleClient implements IPaddleClient {
    private readonly baseUrl: string;

    constructor(
        private readonly apiKey: string,
        environment: "sandbox" | "production",
        private readonly timeoutMs: number = 10_000,
        private readonly metrics?: MetricsService,
    ) {
        if (!apiKey || !apiKey.trim()) {
            throw new Error("Paddle API key is required");
        }
        this.baseUrl = environment === "production"
            ? "https://api.paddle.com"
            : "https://sandbox-api.paddle.com";
    }

    async cancelSubscription(subscriptionId: string): Promise<void> {
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const start = Date.now();
            let response: Response | null = null;
            try {
                response = await fetch(`${this.baseUrl}/subscriptions/${subscriptionId}/cancel`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ effective_from: "next_billing_period" }),
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
            } catch (error) {
                const duration = (Date.now() - start) / 1000;
                try {
                    this.metrics?.paddleRequestDuration.observe({ status: "error" }, duration);
                } catch {}
                if (attempt < maxAttempts - 1) {
                    const backoff = this.jitterBackoff(attempt);
                    await this.sleep(Math.min(backoff, 30000));
                    continue;
                }
                throw error;
            }

            const duration = (Date.now() - start) / 1000;
            const statusStr = String(response.status);
            try {
                this.metrics?.paddleRequestDuration.observe({ status: statusStr }, duration);
                this.metrics?.paddleCancelTotal.inc({ status: statusStr });
            } catch {}

            // Idempotent success: already canceled or not found (treat 404 as success for cancel)
            if (response.status === 409 || response.status === 404) {
                // Drain body for keep-alive
                try { await response.body?.cancel(); } catch {}
                if (response.status === 409) Logger.warn("Subscription already canceled in Paddle", { subscriptionId });
                else Logger.warn("Subscription not found in Paddle (treated as canceled)", { subscriptionId });
                return;
            }

            const retryableStatuses = new Set([429, 503, 500, 502, 504, 408]);
            if (retryableStatuses.has(response.status)) {
                if (attempt < maxAttempts - 1) {
                    // Drain body before retry to avoid socket leak
                    try { await response.body?.cancel(); } catch {}
                    const retryAfter = this.parseRetryAfter(response.headers.get("Retry-After"));
                    const cappedRetryAfter = retryAfter !== null ? Math.min(retryAfter, 30000) : null;
                    const backoff = cappedRetryAfter ?? this.jitterBackoff(attempt);
                    const cappedBackoff = Math.min(backoff, 30000);
                    Logger.warn("Paddle retryable error, retrying", { subscriptionId, status: response.status, attempt, backoff: cappedBackoff });
                    await this.sleep(cappedBackoff);
                    continue;
                }
            }

            if (!response.ok) {
                const errorData = await this.safeParseErrorBody(response);
                Logger.error("Paddle API error during subscription cancellation", {
                    subscriptionId,
                    status: response.status,
                    errorData,
                } as any);
                throw new Error(
                    `Paddle API error ${response.status} while canceling subscription ${subscriptionId}: ${JSON.stringify(errorData)}`
                );
            }

            // Drain success body for keep-alive (even 2xx may have body)
            try { await response.body?.cancel(); } catch {}
            return;
        }
    }

    private parseRetryAfter(header: string | null): number | null {
        if (!header) return null;
        const secs = parseInt(header, 10);
        if (!isNaN(secs)) return Math.min(secs * 1000, 30000);
        const dateMs = Date.parse(header);
        if (!isNaN(dateMs)) {
            const diff = dateMs - Date.now();
            if (diff > 0) return Math.min(diff, 30000);
            return null;
        }
        return null;
    }

    private jitterBackoff(attempt: number): number {
        const base = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        const jitter = Math.random() * 0.5 * base; // up to 50% jitter
        return Math.min(base + jitter, 30000);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async safeParseErrorBody(response: Response): Promise<unknown> {
        try {
            const text = await response.text();
            if (!text) return { body: "<empty response body>" };
            try {
                return JSON.parse(text);
            } catch {
                return { body: text.slice(0, 512) || "<empty response body>" };
            }
        } catch {
            return { body: "<empty response body>" };
        }
    }
}
