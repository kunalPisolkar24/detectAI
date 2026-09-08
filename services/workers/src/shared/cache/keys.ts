import { createHash } from "crypto";

/**
 * Unified cache key schema — mirrors `apps/web/lib/services/cache-keys.ts`.
 * `redis-cache` holds user basic/sub + rate-limit + analytics dedup.
 * `redis-events` is Paddle-only (paddle:evt:*, payment:event:ts:*).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 16);
}

export const CacheKeys = {
  userBasic: (id: string) => `user:basic:${id}`,
  userBasicByEmail: (email: string) => `user:basic:email:${emailHash(email)}`,
  userSub: (id: string) => `user:sub:${id}`,
  dailyUsage: (userId: string, utcDay: string) => `rate_limit:{${userId}}:daily:${utcDay}`,
  analyticsDedup: (eventId: string) => `analytics:usage:event:${eventId}`,

  /**
   * Transitional: canonical user invalidation targets for the post-split
   * world (basic + sub + email pointer).
   */
  user: (id: string) => `user:basic:${id}`,
  userByEmail: (email: string) => `user:basic:email:${emailHash(email)}`,

  /** Transitional DEL targets — old schemes, remove after one release. */
  legacy: {
    webUser: (id: string) => `user:id:${id}`,
    webUserByEmail: (email: string) => `user:email:${email}`,
    workerUser: (id: string) => `v1:user:id:${id}`,
    workerUserByEmail: (email: string) => `v1:user:email:${emailHash(email)}`,
  },
} as const;

export const CacheTTL = {
  USER_BASIC: 3600,
  USER_BASIC_BY_EMAIL: 3600,
  USER_SUB: 600,
  ANALYTICS_DEDUP: 7 * 24 * 60 * 60,
} as const;
