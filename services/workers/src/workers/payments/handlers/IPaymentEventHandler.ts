import type { PaddleEventData } from "../types";

export interface IPaymentEventHandler {
    handle(userId: string | null, data: PaddleEventData): Promise<void>;
}
