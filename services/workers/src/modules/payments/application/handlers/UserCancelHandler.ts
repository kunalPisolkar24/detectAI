import { UserCacheInvalidator } from "@shared/cache/invalidation";
import { SubscriptionStatus } from "../../../../../generated/prisma/client";
import { type IUserRepository } from "@modules/user/domain/IUserRepository";
import { type RedisClient } from "@shared/cache/RedisClient";
import { EventDeduplicator } from "@shared/cache/EventDeduplicator";
import { type IPaddleClient } from "../../infrastructure/external/PaddleClient";
import { type PaddleEventData } from "../../domain/types";
import { MetricsService } from "@shared/monitoring/MetricsService";
import { Logger } from "@shared/logging/Logger";
import { InvalidTransitionError } from "../../domain/stateMachine";
import { UserNotFoundError, MissingFieldError } from "../../domain/errors";
import type { IPaymentEventHandler } from "./IPaymentEventHandler";

export class UserCancelHandler implements IPaymentEventHandler {
  private readonly cacheInvalidator: UserCacheInvalidator;

  private readonly deduplicator: EventDeduplicator;

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly paddleClient: IPaddleClient,
    private readonly redis: RedisClient,
    eventRedis: RedisClient,
    private readonly metrics: MetricsService
  ) {
    this.cacheInvalidator = new UserCacheInvalidator(redis, metrics);
    this.deduplicator = new EventDeduplicator(eventRedis);
  }

  async handle(userId: string | null, data: PaddleEventData): Promise<void> {
    const paddleSubscriptionId = (data as any).paddleSubscriptionId as string | undefined;
    if (!paddleSubscriptionId) {
      throw new MissingFieldError("paddleSubscriptionId");
    }

    const resolvedUserId = userId ?? data.custom_data?.userId ?? (data as any).userId ?? null;
    if (!resolvedUserId) {
      throw new MissingFieldError("userId");
    }

    const eventTimestamp = this.parseEventTimestamp(data.occurred_at);

    if (await this.deduplicator.isStale(resolvedUserId, eventTimestamp)) return;

    // Validate user exists BEFORE external side-effect to avoid Paddle divergence
    const user = await this.userRepository.findUniqueById(resolvedUserId);
    if (!user) throw new UserNotFoundError(resolvedUserId);

    // Pre-invalidate before DB write to shrink the stale-read window.
    await this.cacheInvalidator.invalidateUser(resolvedUserId, user.email);

    await this.paddleClient.cancelSubscription(paddleSubscriptionId);

    let result: { stale: boolean; email: string } | null = null;
    try {
      result = await this.userRepository.lockAndUpdateSubscription(
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
        await this.cacheInvalidator.invalidateUser(resolvedUserId, result.email);
      }
    } catch (error) {
      if (error instanceof InvalidTransitionError && error.from === error.to) {
        Logger.info("Idempotent self-transition, already in target state", { userId: resolvedUserId, from: error.from, to: error.to });
        result = { stale: true, email: user.email } as any;
      } else {
        throw error;
      }
    }

    if (result && !result.stale) {
      await this.deduplicator.markProcessed(resolvedUserId, eventTimestamp);
    }
  }

  private parseEventTimestamp(occurredAt?: string): Date {
    if (!occurredAt) return new Date();
    const d = new Date(occurredAt);
    if (isNaN(d.getTime())) throw new MissingFieldError("occurred_at");
    return d;
  }

}
