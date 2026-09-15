import { createHash } from "crypto"

// Keys for REDIS_URL (single redis-users instance). Email hashed to avoid PII.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function emailHash(email: string): string {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 16)
}

export const CacheKeys = {
  userBasic: (id: string) => `user:basic:${id}`,
  userBasicByEmail: (email: string) => `user:basic:email:${emailHash(email)}`,
  userSub: (id: string) => `user:sub:${id}`,
  dailyUsage: (userId: string, utcDay: string) => `rate_limit:${userId}:daily:${utcDay}`,
  analyticsDedup: (eventId: string) => `analytics:usage:event:${eventId}`,
} as const

export const CacheTTL = {
  USER_BASIC: 3600,
  USER_BASIC_BY_EMAIL: 3600,
  USER_SUB: 600,
  ANALYTICS_DEDUP: 7 * 24 * 60 * 60,
} as const
