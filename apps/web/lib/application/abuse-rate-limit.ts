import { redis } from "@/lib/infrastructure/redis"
import { metrics } from "@/lib/infrastructure/metrics"
import { logger } from "@/lib/infrastructure/logger"
import { env } from "@/lib/config/env"
import { CacheKeys, hashRateLimitIdentifier } from "@/lib/domain/cache-keys"
import { isPreviewMode } from "@/lib/config/preview"

export type AbuseScope = "analyze" | "auth" | "default"

export interface AbuseConsumeInput {
  scope: AbuseScope
  ip?: string | null
  userId?: string | null
  now?: number
}

export interface AbuseRateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  windowMs: number
  retryAfterMs: number
  degraded: boolean
}

interface ScopeConfig {
  limit: number
  windowMs: number
}

const FALLBACK_LIMITS: Record<AbuseScope, ScopeConfig> = {
  analyze: { limit: 20, windowMs: 60_000 },
  auth: { limit: 30, windowMs: 60_000 },
  default: { limit: 120, windowMs: 60_000 },
}

const INCR_EXPIRE_LUA = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return current
`

type MemoryEntry = { count: number; resetAt: number }

const MEMORY_MAX_ENTRIES = 5000
const memoryBuckets = new Map<string, MemoryEntry>()

export function resetAbuseRateLimitMemoryForTests(): void {
  memoryBuckets.clear()
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : (value as number)
  if (typeof n === "number" && Number.isFinite(n) && n > 0) return Math.floor(n)
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallback
}

function getScopeConfig(scope: AbuseScope): ScopeConfig {
  const fallback = FALLBACK_LIMITS[scope]
  try {
    if (scope === "analyze") {
      return {
        limit: toPositiveInt(env.ABUSE_RATE_LIMIT_ANALYZE_MAX, fallback.limit),
        windowMs: toPositiveInt(env.ABUSE_RATE_LIMIT_ANALYZE_WINDOW_MS, fallback.windowMs),
      }
    }
    if (scope === "auth") {
      return {
        limit: toPositiveInt(env.ABUSE_RATE_LIMIT_AUTH_MAX, fallback.limit),
        windowMs: toPositiveInt(env.ABUSE_RATE_LIMIT_AUTH_WINDOW_MS, fallback.windowMs),
      }
    }
    return {
      limit: toPositiveInt(env.ABUSE_RATE_LIMIT_DEFAULT_MAX, fallback.limit),
      windowMs: toPositiveInt(env.ABUSE_RATE_LIMIT_DEFAULT_WINDOW_MS, fallback.windowMs),
    }
  } catch {
    return fallback
  }
}

export function extractClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first.slice(0, 100)
  }
  const realIp = headers.get("x-real-ip")?.trim()
  if (realIp) return realIp.slice(0, 100)
  return null
}

function resolveIdentifier(ip: string | null | undefined, userId: string | null | undefined): { keyPart: string; logPart: string } {
  if (userId) return { keyPart: `u:${userId}`, logPart: userId }
  if (ip) {
    const hashed = hashRateLimitIdentifier(ip)
    return { keyPart: `ip:${hashed}`, logPart: `ip:${hashed}` }
  }
  return { keyPart: "ip:unknown", logPart: "ip:unknown" }
}

function consumeMemory(key: string, windowMs: number, limit: number, now: number): AbuseRateLimitResult {
  const windowId = Math.floor(now / windowMs)
  const windowEnd = (windowId + 1) * windowMs
  const namespaced = `${key}:${windowId}`

  let entry = memoryBuckets.get(namespaced)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: windowEnd }
    if (!memoryBuckets.has(namespaced) && memoryBuckets.size >= MEMORY_MAX_ENTRIES) {
      const oldest = memoryBuckets.keys().next()
      if (!oldest.done) memoryBuckets.delete(oldest.value)
    }
    memoryBuckets.set(namespaced, entry)
  } else {
    entry.count += 1
  }

  const allowed = entry.count <= limit
  return {
    allowed,
    remaining: Math.max(0, limit - entry.count),
    limit,
    windowMs,
    retryAfterMs: allowed ? 0 : Math.max(0, entry.resetAt - now),
    degraded: true,
  }
}

export interface IAbuseRateLimitService {
  consume(input: AbuseConsumeInput): Promise<AbuseRateLimitResult>
}

export class RedisAbuseRateLimitService implements IAbuseRateLimitService {
  public async consume(input: AbuseConsumeInput): Promise<AbuseRateLimitResult> {
    const config = getScopeConfig(input.scope)
    const now = input.now ?? Date.now()

    if (isPreviewMode()) {
      return { allowed: true, remaining: config.limit, limit: config.limit, windowMs: config.windowMs, retryAfterMs: 0, degraded: false }
    }

    const { keyPart, logPart } = resolveIdentifier(input.ip, input.userId)
    const windowId = Math.floor(now / config.windowMs)
    const windowEnd = (windowId + 1) * config.windowMs
    const key = CacheKeys.abuseFixedWindow(input.scope, keyPart, windowId)

    try {
      const raw = await (redis as unknown as {
        eval: (script: string, numKeys: number, key: string, window: string) => Promise<unknown>
      }).eval(INCR_EXPIRE_LUA, 1, key, String(config.windowMs))

      const count = typeof raw === "number" ? raw : Number(raw)
      if (!Number.isFinite(count) || count < 1) {
        logger.warn({ msg: "Unexpected abuse counter from Redis, allowing", scope: input.scope, identifier: logPart, raw })
        return { allowed: true, remaining: config.limit, limit: config.limit, windowMs: config.windowMs, retryAfterMs: 0, degraded: false }
      }

      const allowed = count <= config.limit
      if (!allowed) {
        try { metrics.abuseRateLimitHits.inc({ scope: input.scope }) } catch {}
      }
      return {
        allowed,
        remaining: Math.max(0, config.limit - count),
        limit: config.limit,
        windowMs: config.windowMs,
        retryAfterMs: allowed ? 0 : Math.max(0, windowEnd - now),
        degraded: false,
      }
    } catch (error) {
      try { metrics.abuseRedisErrors.inc({ operation: "incr" }) } catch {}
      logger.warn({ msg: "Abuse Redis unavailable, using in-memory fallback", scope: input.scope, identifier: logPart, error })
      const fallback = consumeMemory(key, config.windowMs, config.limit, now)
      if (!fallback.allowed) {
        try { metrics.abuseRateLimitHits.inc({ scope: input.scope }) } catch {}
      }
      return fallback
    }
  }
}

export const abuseRateLimitService = new RedisAbuseRateLimitService()

export function getAbuseRateLimitHeaders(result: AbuseRateLimitResult): Record<string, string> {
  const resetSec = String(Math.ceil(result.retryAfterMs / 1000))
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
  }
  if (!result.allowed) {
    headers["Retry-After"] = resetSec
    headers["RateLimit-Reset"] = resetSec
  }
  return headers
}
