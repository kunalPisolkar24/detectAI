import { createHash } from "crypto"

/**
 * Unified cache key schema — single source of truth for `redis-cache`.
 *
 * Layout (all in ONE instance, `REDIS_URL`):
 * - `user:basic:{id}`            → profile JSON (no subscription/usage joins)
 * - `user:basic:email:{hash16}`  → user id pointer (not full object)
 * - `user:sub:{id}`              → subscription JSON {status,endsAt,planId,...}
 * - `rate_limit:{uid}:daily:YYYY-MM-DD` → counter string (Lua INCRBY+EXPIREAT)
 * - `analytics:usage:event:{id}` → "1" EX 7d (usage dedup, lives in cache)
 *
 * `redis-events` is Paddle-only:
 * - `paddle:evt:{eventId}`       → "1" EX 7d (IdempotencyStore fast path)
 * - `payment:event:ts:{userId}`  → ISO timestamp EX 30d (ordering hint)
 *
 * Email is hashed (sha256 normalized, 16 hex chars) to avoid PII/special
 * chars in keys and to match the worker scheme. The `{uid}` braces in the
 * daily key are a legacy cluster hash-tag — harmless on standalone/sentinel.
 */
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
  dailyUsage: (userId: string, utcDay: string) => `rate_limit:{${userId}}:daily:${utcDay}`,
  analyticsDedup: (eventId: string) => `analytics:usage:event:${eventId}`,
} as const

export const CacheTTL = {
  USER_BASIC: 3600,
  USER_BASIC_BY_EMAIL: 3600,
  USER_SUB: 600,
  ANALYTICS_DEDUP: 7 * 24 * 60 * 60,
} as const
