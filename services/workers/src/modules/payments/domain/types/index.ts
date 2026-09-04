import { SubscriptionStatus } from "../../../../../generated/prisma/client";

export interface PaddleEventData {
  id?: string;
  customer_id?: string;
  status?: string;
  items?: Array<{ price: { id: string } }>;
  custom_data?: { userId?: string };
  current_billing_period?: { ends_at?: string };
  scheduled_change?: { effective_at?: string; action?: string };
  canceled_at?: string;
  occurred_at?: string;
}

export interface PaymentEvent {
  event_id: string;
  event_type: string;
  notification_id?: string;
  occurred_at?: string;
  data: PaddleEventData;
  // compat: some producers use camelCase
  eventId?: string;
  notificationId?: string;
}

