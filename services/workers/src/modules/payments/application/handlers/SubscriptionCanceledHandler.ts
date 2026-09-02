import { UserCacheInvalidator } from "@shared/cache/invalidation";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { EventDeduplicator } from "@shared/cache/EventDeduplicator";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import { type PaddleEventData } from "../../domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";
import { UserNotFoundError, MissingFieldError } from "../../domain/errors";

export class SubscriptionCanceledHandler implements IPaymentEventHandler {
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
    if (!userId) return;

    const subId = data.id;
    if (!subId) throw new MissingFieldError("id");

    const eventTimestamp = this.parseEventTimestamp(data.occurred_at);

    if (await this.deduplicator.isStale(userId, eventTimestamp)) return;

    const user = await this.userRepository.findUniqueById(userId);
    if (!user) throw new UserNotFoundError(userId);

    const endsAt = this.parseDate(data.canceled_at);

    // Pre-invalidate before DB write to shrink the stale-read window.
    // If the write fails, the next read pays a cache-miss penalty — acceptable for consistency.
    await this.cacheInvalidator.invalidateUser(userId, user.email);

    const result = await this.userRepository.lockAndUpdateSubscription(
      userId,
      eventTimestamp,
      SubscriptionStatus.CANCELED,
      {
        paddleCustomerId: "",
        paddleSubscriptionId: null,
        paddlePlanId: null,
        status: SubscriptionStatus.CANCELED,
        endsAt,
        cancellationScheduled: false,
      },
      undefined
    );

    if (!result.stale) {
      await this.cacheInvalidator.invalidateUser(userId, result.email);
      await this.deduplicator.markProcessed(userId, eventTimestamp);
    }
  }

  private parseEventTimestamp(occurredAt?: string): Date {
    if (!occurredAt) return new Date();
    const d = new Date(occurredAt);
    if (isNaN(d.getTime())) throw new MissingFieldError("occurred_at");
    return d;
  }

  private parseDate(raw?: string): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
}
