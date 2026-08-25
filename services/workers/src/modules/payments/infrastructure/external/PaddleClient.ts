import { Logger } from "@shared/logging/Logger";

export interface IPaddleClient {
    cancelSubscription(subscriptionId: string): Promise<void>;
}

export class PaddleClient implements IPaddleClient {
    private readonly baseUrl: string;

    constructor(
        private readonly apiKey: string,
        environment: "sandbox" | "production",
        private readonly timeoutMs: number = 10_000
    ) {
        this.baseUrl = environment === "production"
            ? "https://api.paddle.com"
            : "https://sandbox-api.paddle.com";
    }

    async cancelSubscription(subscriptionId: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}/subscriptions/${subscriptionId}/cancel`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ effective_from: "next_billing_period" }),
            signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 409) {
            Logger.warn("Subscription already canceled in Paddle", { subscriptionId });
            return;
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
