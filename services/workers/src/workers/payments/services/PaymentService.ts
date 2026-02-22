import { SubscriptionStatus } from "../../../../generated/prisma/client";
import { prisma, prismaPrimary } from "@shared/db";
import { type RedisClient } from "@shared/redis";
import { Logger } from "@shared/logger";
import { CacheKeys } from "@shared/cache/keys";
import { LockService } from "@shared/cache/lock";
import { MetricsService } from "@shared/monitoring/MetricsService";
import type { PaymentEvent, PaymentUpdatePayload } from "../types";
import { config } from "../config";

const PADDLE_API_URL = config.PADDLE_ENVIRONMENT === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

export class PaymentService {
  constructor(
    private readonly redis: RedisClient,
    private readonly lockService: LockService,
    private readonly metrics: MetricsService
  ) {}

  public async handleEvent(event: PaymentEvent): Promise<void> {
    const { event_type, data } = event;
    const userId = data?.custom_data?.userId ?? (data as any).userId;
    
    const timer = this.metrics.jobDuration.startTimer({ job_type: event_type });

    if (!userId && event_type !== "user.cancel_subscription") {
        timer({ status: "ignored" });
        return;
    }

    try {
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
      this.metrics.jobTotal.inc({ job_type: event_type });
      timer({ status: "success" });
    } catch (error) {
      Logger.error("Error processing payment event", error, { event_type, userId });
      this.metrics.jobErrors.inc({ job_type: event_type, error_type: "process_failure" });
      timer({ status: "error" });
      throw error;
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

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { email: true }
    });

    await this.invalidateUserCache(userId, updatedUser.email);
  }

  private async handleSubscriptionCancellation(userId: string, data: any): Promise<void> {
    const subId = data.id;
    const endsAt = this.parseEndsAt(data);

    if (!subId) return;

    const user = await prismaPrimary.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    if (!user) return;

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

    await this.invalidateUserCache(userId, user.email);
  }

  private async performCancellation(data: any): Promise<void> {
    const { paddleSubscriptionId } = data;

    if (!paddleSubscriptionId) {
      throw new Error("Missing subscription ID");
    }

    const response = await fetch(`${PADDLE_API_URL}/subscriptions/${paddleSubscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Paddle API Error: ${JSON.stringify(errorData)}`);
    }
  }

  private async invalidateUserCache(userId: string, email: string): Promise<void> {
    const keys = [
      CacheKeys.user(userId),
      CacheKeys.userByEmail(email)
    ];

    try {
      const locks: Array<(() => Promise<void>) | null> = await Promise.all(
        keys.map(key => this.lockService.acquire(key))
      );

      try {
        await this.redis.del(...keys);
        this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
      } finally {
        await Promise.all(
          locks.map(release => release ? release() : Promise.resolve())
        );
      }
    } catch (error) {
      Logger.error("Failed to invalidate cache with locks", error, { userId });
      await this.redis.del(...keys).catch(e => Logger.error("Fallback delete failed", e));
      this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "lock_failure" });
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