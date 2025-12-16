import { SubscriptionStatus } from "./generated/prisma/client";

export interface PaddleEventData {
  id?: string;
  customer_id?: string;
  status?: string;
  items?: Array<{ price: { id: string } }>;
  custom_data?: { userId?: string };
  current_billing_period?: { ends_at?: string };
  scheduled_change?: { effective_at?: string; action?: string };
  canceled_at?: string;
}

export interface PaymentEvent {
  event_type: string;
  data: PaddleEventData;
}

export interface PaymentUpdatePayload {
  paddleCustomerId: string;
  paddleSubscriptionId: string;
  paddlePlanId: string;
  paddleSubscriptionStatus: SubscriptionStatus;
  subscriptionEndsAt: Date | null;
  paddleCancellationScheduled?: boolean;
}