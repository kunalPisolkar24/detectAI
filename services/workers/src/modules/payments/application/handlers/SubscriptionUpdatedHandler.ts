import { UserCacheInvalidator } from "@shared/cache/invalidation";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { EventDeduplicator } from "@shared/cache/EventDeduplicator";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import { type PaddleEventData } from "../../domain/types";
import { type SubscriptionUpdateData } from "@modules/user/domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";
import { UserNotFoundError, MissingFieldError } from "../../domain/errors";

export class SubscriptionUpdatedHandler implements IPaymentEventHandler {
  private readonly cacheInvalidator: UserCacheInvalidator;

  private readonly deduplicator: EventDeduplicator;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly redis: RedisClient,
    eventRedis: RedisClient,
    private readonly metrics: MetricsService
  ) {
    this.cacheInvalidator = new UserCacheInvalidator(redis, metrics);
    this.deduplicator = new EventDeduplicator(eventRedis);
  }

  async handle(userId: string | null, data: PaddleEventData): Promise<void> {
    if (!userId) throw new MissingFieldError("userId");

    const status = this.parseStatus(data.status);
    const subId = data.id;
    const customerId = data.customer_id;
    const planId = data.items?.[0]?.price?.id;
    const endsAt = this.parseEndsAt(data);

    if (!subId) throw new MissingFieldError("id");
    if (!status) throw new MissingFieldError("status");
    if (!customerId) throw new MissingFieldError("customer_id");
    if (!planId) {
      Logger.warn("Missing planId, updating without overwriting paddlePlanId", { userId, subId });
      try {
        this.metrics.jobErrors.inc({ job_type: "subscription.updated", error_type: "missing_planId" });
      } catch {}
    }

    const eventTimestamp = this.parseEventTimestamp(data.occurred_at);

    if (await this.deduplicator.isStale(userId, eventTimestamp)) return;

    const user = await this.userRepository.findUniqueById(userId);
    if (!user) throw new UserNotFoundError(userId);

    const updateData: SubscriptionUpdateData = {
      paddleCustomerId: customerId,
      paddleSubscriptionId: subId,
      paddlePlanId: planId ?? undefined,
      status,
      endsAt,
      cancellationScheduled: data.scheduled_change?.action === "cancel",
    };

    // Pre-invalidate before DB write to shrink the stale-read window.
    // If the write fails, the next read pays a cache-miss penalty — acceptable for consistency.
    await this.cacheInvalidator.invalidateUser(userId, user.email);

    const result = await this.userRepository.lockAndUpdateSubscription(userId, eventTimestamp, status, updateData, customerId);

    if (!result.stale) {
      await this.cacheInvalidator.invalidateUser(userId, result.email);
      await this.deduplicator.markProcessed(userId, eventTimestamp);
    }
  }


  private parseStatus(status?: string): SubscriptionStatus | null {
    if (!status) return null;
    const s = status.toUpperCase();
    if (Object.values(SubscriptionStatus).includes(s as SubscriptionStatus)) {
      return s as SubscriptionStatus;
    }
    return null;
  }

  private parseEndsAt(data: PaddleEventData): Date | null {
    const raw = data?.current_billing_period?.ends_at || data?.scheduled_change?.effective_at;
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  private parseEventTimestamp(occurredAt?: string): Date {
    if (!occurredAt) return new Date();
    const d = new Date(occurredAt);
    if (isNaN(d.getTime())) {
      throw new MissingFieldError("occurred_at");
    }
    return d;
  }
}
