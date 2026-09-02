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
                    await this.sleep(backoff);
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

            if (response.status === 409) {
                Logger.warn("Subscription already canceled in Paddle", { subscriptionId });
                return;
            }

            if (response.status === 429 || response.status === 503) {
                if (attempt < maxAttempts - 1) {
                    const retryAfter = this.parseRetryAfter(response.headers.get("Retry-After"));
                    const backoff = retryAfter ?? this.jitterBackoff(attempt);
                    Logger.warn("Paddle rate limited, retrying", { subscriptionId, status: response.status, attempt, backoff });
                    await this.sleep(backoff);
                    continue;
                }
            }

            if (!response.ok) {
                const errorData = await this.safeParseErrorBody(response);
                Logger.error("Paddle API error during subscription cancellation", {
                    subscriptionId,
                    status: response.status,
                    errorData,
                });
                throw new Error(
                    `Paddle API error ${response.status} while canceling subscription ${subscriptionId}: ${JSON.stringify(errorData)}`
                );
            }

            return;
        }
    }

    private parseRetryAfter(header: string | null): number | null {
        if (!header) return null;
        const secs = parseInt(header, 10);
        if (!isNaN(secs)) return secs * 1000;
        const dateMs = Date.parse(header);
        if (!isNaN(dateMs)) {
            const diff = dateMs - Date.now();
            return diff > 0 ? diff : null;
        }
        return null;
    }

    private jitterBackoff(attempt: number): number {
        const base = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        const jitter = Math.random() * 0.5 * base; // up to 50% jitter
        return base + jitter;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async safeParseErrorBody(response: Response): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            const text = await response.text().catch(() => "");
            return { body: text.slice(0, 512) || "<empty response body>" };
        }
    }
}
