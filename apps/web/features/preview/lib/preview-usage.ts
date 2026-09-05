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

export function getPreviewUsage(): PreviewUsage {
  if (typeof window === "undefined") return { dailyCount: 0, totalCount: 0 }
  try {
    const storedDate = localStorage.getItem(DATE_KEY)
    const today = todayKey()
    let daily = readInt(DAILY_KEY, 0)
    const total = readInt(TOTAL_KEY, 0)
    if (storedDate !== today) {
      daily = 0
      try {
        localStorage.setItem(DAILY_KEY, "0")
        localStorage.setItem(DATE_KEY, today)
      } catch {}
    }
    return { dailyCount: daily, totalCount: total }
  } catch {
    return { dailyCount: 0, totalCount: 0 }
  }
}

export function incrementPreviewUsage(): PreviewUsage {
  if (typeof window === "undefined") return { dailyCount: 0, totalCount: 0 }
  const today = todayKey()
  const storedDate = (() => {
    try {
      return localStorage.getItem(DATE_KEY)
    } catch {
      return null
    }
  })()
  let daily = readInt(DAILY_KEY, 0)
  let total = readInt(TOTAL_KEY, 0)
  if (storedDate !== today) {
    daily = 0
  }
  daily += 1
  total += 1
  try {
    localStorage.setItem(DAILY_KEY, String(daily))
    localStorage.setItem(TOTAL_KEY, String(total))
    localStorage.setItem(DATE_KEY, today)
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { dailyCount: daily, totalCount: total } }))
  } catch {}
  try {
    window.dispatchEvent(new Event("storage"))
  } catch {}
  return { dailyCount: daily, totalCount: total }
}

export function subscribePreviewUsage(callback: (usage: PreviewUsage) => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => callback(getPreviewUsage())
  window.addEventListener("storage", handler)
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => {
    window.removeEventListener("storage", handler)
    window.removeEventListener(EVENT_NAME, handler as EventListener)
  }
}

export function resetPreviewUsage(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(DAILY_KEY)
    localStorage.removeItem(TOTAL_KEY)
    localStorage.removeItem(DATE_KEY)
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { dailyCount: 0, totalCount: 0 } }))
  } catch {}
}
