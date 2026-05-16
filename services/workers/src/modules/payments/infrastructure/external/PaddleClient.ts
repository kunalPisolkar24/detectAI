import { Logger } from "@shared/logging/Logger";

export interface IPaddleClient {
    cancelSubscription(subscriptionId: string): Promise<void>;
}

export class PaddleClient implements IPaddleClient {
    private readonly baseUrl: string;

    constructor(
        private readonly apiKey: string,
        environment: "sandbox" | "production"
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
        });

        if (!response.ok) {
            const errorData = await response.json();
            Logger.error("Paddle API error during subscription cancellation", { subscriptionId, errorData });
            throw new Error(`Paddle API Error: ${JSON.stringify(errorData)}`);
        }
    }
}
