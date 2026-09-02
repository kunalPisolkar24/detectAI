import { SubscriptionStatus } from "../../../../generated/prisma/client";

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string | null,
    public readonly to: string,
  ) {
    super(`Invalid subscription status transition: ${from ?? "null"} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

const validTransitions: Record<string, Set<string>> = {
  null: new Set([SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE]),
  [SubscriptionStatus.TRIALING]: new Set([
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.PAST_DUE,
  ]),
  [SubscriptionStatus.ACTIVE]: new Set([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.PAUSED,
  ]),
  [SubscriptionStatus.PAUSED]: new Set([
    SubscriptionStatus.PAUSED,
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
  ]),
  [SubscriptionStatus.PAST_DUE]: new Set([
    SubscriptionStatus.PAST_DUE,
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
  ]),
  [SubscriptionStatus.CANCELED]: new Set([
    SubscriptionStatus.CANCELED,
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
  ]),
};

export function validateTransition(
  current: SubscriptionStatus | null,
  next: SubscriptionStatus
): void {
  const key = current ?? "null";
  const allowed = validTransitions[key];
  if (!allowed || !allowed.has(next)) {
    throw new InvalidTransitionError(current as string | null, next);
  }
}
