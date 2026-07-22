import { SubscriptionStatus } from "../../../../generated/prisma/client";

const validTransitions: Record<string, Set<string>> = {
  null: new Set([SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE]),
  [SubscriptionStatus.TRIALING]: new Set([
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
  [SubscriptionStatus.PAUSED]: new Set([SubscriptionStatus.ACTIVE]),
  [SubscriptionStatus.PAST_DUE]: new Set([
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELED,
  ]),
  [SubscriptionStatus.CANCELED]: new Set([
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
    throw new Error(
      `Invalid subscription status transition: ${current ?? "null"} -> ${next}`
    );
  }
}
