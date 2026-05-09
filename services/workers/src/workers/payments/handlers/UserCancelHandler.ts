import { type IPaddleClient } from "../gateways/PaddleClient";
import { type PaddleEventData } from "../types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

export class UserCancelHandler implements IPaymentEventHandler {
    constructor(private readonly paddleClient: IPaddleClient) {}

    async handle(_userId: string | null, data: PaddleEventData): Promise<void> {
        const paddleSubscriptionId = (data as any).paddleSubscriptionId as string | undefined;

        if (!paddleSubscriptionId) {
            throw new Error("Missing subscription ID");
        }

        await this.paddleClient.cancelSubscription(paddleSubscriptionId);
    }
}
