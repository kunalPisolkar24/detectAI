import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/infrastructure/persistence/PrismaUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { CacheKeys } from "@shared/cache/keys";
import { EventDeduplicator } from "@shared/cache/EventDeduplicator";
import { type IPaddleClient } from "../../infrastructure/external/PaddleClient";
import { type PaddleEventData } from "../../domain/types";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

export class UserCancelHandler implements IPaymentEventHandler {
  private readonly deduplicator: EventDeduplicator;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly paddleClient: IPaddleClient,
    private readonly redis: RedisClient,
    eventRedis: RedisClient,
    private readonly metrics: MetricsService
  ) {
    this.deduplicator = new EventDeduplicator(eventRedis);
  }

  async handle(userId: string | null, data: PaddleEventData): Promise<void> {
    const paddleSubscriptionId = (data as any).paddleSubscriptionId as string | undefined;
    if (!paddleSubscriptionId) {
      throw new Error("Missing subscription ID");
    }

    const resolvedUserId = userId ?? data.custom_data?.userId ?? (data as any).userId ?? null;
    if (!resolvedUserId) {
      throw new Error("Missing userId for cancel subscription");
    }

    const eventTimestamp = data.occurred_at ? new Date(data.occurred_at) : new Date();

    if (await this.deduplicator.isStale(resolvedUserId, eventTimestamp)) return;

    const currentStatus = await this.userRepository.getSubscriptionStatusWithLock(resolvedUserId);

    if (currentStatus === SubscriptionStatus.CANCELED) {
      Logger.info("Subscription already canceled, skipping Paddle API call", { userId: resolvedUserId, paddleSubscriptionId });
      return;
    }

    await this.paddleClient.cancelSubscription(paddleSubscriptionId);

    const user = await this.userRepository.findUniqueById(resolvedUserId);
    if (user) {
      // Pre-invalidate before DB write to shrink the stale-read window.
      // If the write fails, the next read pays a cache-miss penalty — acceptable for consistency.
      await this.invalidateCache(resolvedUserId, user.email);
    }

    const result = await this.userRepository.lockAndUpdateSubscription(
      resolvedUserId,
      eventTimestamp,
      SubscriptionStatus.CANCELED,
      {
        paddleCustomerId: "",
        paddleSubscriptionId: null,
        paddlePlanId: null,
        status: SubscriptionStatus.CANCELED,
        endsAt: null,
        cancellationScheduled: false,
      },
      undefined
    );

    if (!result.stale) {
      await this.invalidateCache(resolvedUserId, result.email);
      await this.deduplicator.markProcessed(resolvedUserId, eventTimestamp);
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
