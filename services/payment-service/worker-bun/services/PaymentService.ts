import { SubscriptionStatus } from "../generated/prisma/client";
import { prisma } from "../db";
import type { PaymentEvent, PaymentUpdatePayload } from "../types";

export class PaymentService {
  public async handleEvent(event: PaymentEvent): Promise<void> {
    const { event_type, data } = event;
    const userId = data?.custom_data?.userId;

    if (!userId) return;

    switch (event_type) {
      case "subscription.created":
      case "subscription.updated":
        await this.handleSubscriptionUpdate(userId, data);
        break;

      case "subscription.canceled":
        await this.handleSubscriptionCancellation(userId, data);
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

    if (data?.scheduled_change?.action !== "cancel") {
      updateData.paddleCancellationScheduled = false;
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