"use client"

const TOTAL_KEY = "preview:usage:total"
const DAILY_KEY = "preview:usage:daily"
const DATE_KEY = "preview:usage:date"
const EVENT_NAME = "preview:usage-change"

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function readInt(key: string, fallback = 0): number {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? fallback : n
  } catch {
    return fallback
  }
}

export interface PreviewUsage {
  dailyCount: number
  totalCount: number
}

function scopedKeys(userId?: string | null): { total: string; daily: string; date: string } {
  const suffix = userId ? `:${userId}` : ""
  return {
    total: `${TOTAL_KEY}${suffix}`,
    daily: `${DAILY_KEY}${suffix}`,
    date: `${DATE_KEY}${suffix}`,
  }
}

/**
 * One-time adoption of pre-scoping global counters into a user's scope.
 * Chats stay archived per the isolation policy, but trivial counters carry
 * over so a returning user doesn't see a confusing reset.
 */
function adoptLegacyUsage(userId: string): void {
  try {
    if (localStorage.getItem(`${TOTAL_KEY}:${userId}`) !== null) return
    const legacyTotal = localStorage.getItem(TOTAL_KEY)
    if (legacyTotal === null) return
    const keys = scopedKeys(userId)
    localStorage.setItem(keys.total, legacyTotal)
    const legacyDaily = localStorage.getItem(DAILY_KEY)
    const legacyDate = localStorage.getItem(DATE_KEY)
    if (legacyDaily !== null) localStorage.setItem(keys.daily, legacyDaily)
    if (legacyDate !== null) localStorage.setItem(keys.date, legacyDate)
    localStorage.removeItem(TOTAL_KEY)
    localStorage.removeItem(DAILY_KEY)
    localStorage.removeItem(DATE_KEY)
  } catch {}
}

export function getPreviewUsage(userId?: string | null): PreviewUsage {
  if (typeof window === "undefined") return { dailyCount: 0, totalCount: 0 }
  try {
    if (userId) adoptLegacyUsage(userId)
    const keys = scopedKeys(userId)
    const storedDate = localStorage.getItem(keys.date)
    const today = todayKey()
    let daily = readInt(keys.daily, 0)
    const total = readInt(keys.total, 0)
    if (storedDate !== today) {
      daily = 0
      try {
        localStorage.setItem(keys.daily, "0")
        localStorage.setItem(keys.date, today)
      } catch {}
    }
    return { dailyCount: daily, totalCount: total }
  } catch {
    return { dailyCount: 0, totalCount: 0 }
  }
}

export function incrementPreviewUsage(userId?: string | null): PreviewUsage {
  if (typeof window === "undefined") return { dailyCount: 0, totalCount: 0 }
  if (userId) adoptLegacyUsage(userId)
  const keys = scopedKeys(userId)
  const today = todayKey()
  const storedDate = (() => {
    try {
      return localStorage.getItem(keys.date)
    } catch {
      return null
    }
  })()
  let daily = readInt(keys.daily, 0)
  let total = readInt(keys.total, 0)
  if (storedDate !== today) {
    daily = 0
  }
  daily += 1
  total += 1
  try {
    localStorage.setItem(keys.daily, String(daily))
    localStorage.setItem(keys.total, String(total))
    localStorage.setItem(keys.date, today)
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { dailyCount: daily, totalCount: total } }))
  } catch {}
  try {
    window.dispatchEvent(new Event("storage"))
  } catch {}
  return { dailyCount: daily, totalCount: total }
}

export function subscribePreviewUsage(callback: (usage: PreviewUsage) => void, userId?: string | null): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => callback(getPreviewUsage(userId))
  window.addEventListener("storage", handler)
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => {
    window.removeEventListener("storage", handler)
    window.removeEventListener(EVENT_NAME, handler as EventListener)
  }
}

