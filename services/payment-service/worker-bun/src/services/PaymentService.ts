import { SubscriptionStatus } from "../../generated/prisma/client";
import { prisma } from "../lib/db";
import type { PaymentEvent, PaymentUpdatePayload } from "../types";

const PADDLE_API_URL = process.env.PADDLE_ENVIRONMENT === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

export class PaymentService {
  public async handleEvent(event: PaymentEvent): Promise<void> {
    const { event_type, data } = event;
    const userId = data?.custom_data?.userId ?? (data as any).userId;

    if (!userId && event_type !== "user.cancel_subscription") return;

    switch (event_type) {
      case "subscription.created":
      case "subscription.updated":
        if (userId) await this.handleSubscriptionUpdate(userId, data);
        break;

      case "subscription.canceled":
        if (userId) await this.handleSubscriptionCancellation(userId, data);
        break;

      case "user.cancel_subscription":
        await this.performCancellation(data);
        break;
    }
  }

  private async handleSubscriptionUpdate(userId: string, data: any): Promise<void> {
    const status = this.parseStatus(data.status);
    const subId = data.id;
    const customerId = data.customer_id;
    const planId = data.items?.[0]?.price?.id;
    const endsAt = this.parseEndsAt(data);

    if (!subId || !status || !customerId || !planId) return;

    const updateData: PaymentUpdatePayload = {
      paddleCustomerId: customerId,
      paddleSubscriptionId: subId,
      paddlePlanId: planId,
      paddleSubscriptionStatus: status,
      subscriptionEndsAt: endsAt,
    };

    if (data?.scheduled_change) {
      updateData.paddleCancellationScheduled = data.scheduled_change.action === 'cancel';
    }

    await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  private async handleSubscriptionCancellation(userId: string, data: any): Promise<void> {
    const subId = data.id;
    const endsAt = this.parseEndsAt(data);

    if (!subId) return;

    await prisma.user.updateMany({
      where: {
        id: userId,
        paddleSubscriptionId: subId,
      },
      data: {
        paddleSubscriptionStatus: SubscriptionStatus.CANCELED,
        subscriptionEndsAt: endsAt,
        paddleCancellationScheduled: false,
        paddleSubscriptionId: null,
        paddlePlanId: null,
      },
    });
  }

  private async performCancellation(data: any): Promise<void> {
    const { paddleSubscriptionId } = data;

    if (!paddleSubscriptionId || !PADDLE_API_KEY) {
      throw new Error("Missing subscription ID or API Key");
    }

    const response = await fetch(`${PADDLE_API_URL}/subscriptions/${paddleSubscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Paddle API Error: ${JSON.stringify(errorData)}`);
    }
  }

  private parseStatus(status?: string): SubscriptionStatus | null {
    if (!status) return null;
    const s = status.toUpperCase();
    if (Object.values(SubscriptionStatus).includes(s as any)) {
      return s as SubscriptionStatus;
    }
    return null;
  }

  private parseEndsAt(data: any): Date | null {
    const raw =
      data?.current_billing_period?.ends_at ||
      data?.scheduled_change?.effective_at ||
      data?.canceled_at;
    return raw ? new Date(raw) : null;
  }
}