"use client"

import { useEffect } from "react"

const RETRY_INTERVAL_MS = 100
const MAX_RETRY_MS = 2000

const scrollToSection = (id: string): boolean => {
  const target = document.getElementById(id)
  if (!target) return false
  // `scroll-behavior: smooth` (globals.css) animates this; kept explicit so
  // keyboard / reduced-motion preferences still resolve sanely.
  target.scrollIntoView({ behavior: "smooth", block: "start" })
  return true
}

/**
 * Ensures landing-page anchor jumps actually land.
 *
 * Same-page `/#section` clicks are handled by Next.js and animated by the
 * global smooth-scroll CSS. This helper covers the cases Next.js misses:
 * cross-page jumps (e.g. footer links from /about) and pasted/back-forward
 * URLs, retried briefly so lazily-hydrated sections are found once mounted.
 * Rendered only on the landing page, so other routes are unaffected.
 */
export const LandingHashScroll = () => {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const scrollWithRetry = (id: string) => {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
      if (!id || scrollToSection(id)) return
      const startedAt = Date.now()
      timer = setInterval(() => {
        if (scrollToSection(id) || Date.now() - startedAt >= MAX_RETRY_MS) {
          if (timer) {
            clearInterval(timer)
            timer = undefined
          }
        }
      }, RETRY_INTERVAL_MS)
    }

    const hashId = () => window.location.hash.replace(/^#/, "")

    const handleHashChange = () => {
      const id = hashId()
      if (id) scrollWithRetry(id)
    }
    window.addEventListener("hashchange", handleHashChange)

    // Entry with a hash — deferred past hydration so dynamically
    // imported sections can mount before the first attempt.
    let entryTimer: ReturnType<typeof setTimeout> | undefined
    if (hashId()) {
      entryTimer = setTimeout(() => {
        const id = hashId()
        if (id) scrollWithRetry(id)
      }, 0)
    }

    return () => {
      if (entryTimer) clearTimeout(entryTimer)
      window.removeEventListener("hashchange", handleHashChange)
      if (timer) clearInterval(timer)
    }
  }, [])

  return null
}
