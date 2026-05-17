import type { PaddleEventData } from "../../domain/types";

export interface IPaymentEventHandler {
    handle(userId: string | null, data: PaddleEventData): Promise<void>;
}
