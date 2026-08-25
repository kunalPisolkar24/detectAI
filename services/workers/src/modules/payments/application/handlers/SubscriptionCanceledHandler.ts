import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { CacheKeys } from "@shared/cache/keys";
import { EventDeduplicator } from "@shared/cache/EventDeduplicator";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import { type PaddleEventData } from "../../domain/types";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";
import { UserNotFoundError } from "../../domain/errors";

export class SubscriptionCanceledHandler implements IPaymentEventHandler {
  private readonly deduplicator: EventDeduplicator;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly redis: RedisClient,
    eventRedis: RedisClient,
    private readonly metrics: MetricsService
  ) {
    this.deduplicator = new EventDeduplicator(eventRedis);
  }

  async handle(userId: string | null, data: PaddleEventData): Promise<void> {
    if (!userId) return;

    const subId = data.id;
    if (!subId) return;

    const eventTimestamp = data.occurred_at ? new Date(data.occurred_at) : new Date();

    if (await this.deduplicator.isStale(userId, eventTimestamp)) return;

    const user = await this.userRepository.findUniqueById(userId);
    if (!user) throw new UserNotFoundError(userId);

    const endsAt = data.canceled_at ? new Date(data.canceled_at) : null;

    // Pre-invalidate before DB write to shrink the stale-read window.
    // If the write fails, the next read pays a cache-miss penalty — acceptable for consistency.
    await this.invalidateCache(userId, user.email);

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
      await this.invalidateCache(userId, result.email);
      await this.deduplicator.markProcessed(userId, eventTimestamp);
    }
  }

  private async invalidateCache(userId: string, email: string): Promise<void> {
    const keys = [CacheKeys.user(userId), CacheKeys.userByEmail(email)];
    try {
      await this.redis.del(...keys);
      this.metrics.cacheOperations.inc({ operation: "invalidate", cache_type: "main" }, keys.length);
    } catch (error) {
      Logger.error("Failed to invalidate cache", error, { userId });
      this.metrics.jobErrors.inc({ job_type: "cache_invalidate", error_type: "redis_error" });
    }
  }
}
