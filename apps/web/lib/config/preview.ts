export const PREVIEW_TOOLTIP = "Not available in preview mode"
export const DOCUMENT_PARSER_UNAVAILABLE_TOOLTIP = "Document parsing is temporarily unavailable"
export const PREVIEW_PREMIUM_KEY = "preview:isPremium"
export const PREVIEW_DONT_SHOW_NOTICE_KEY = "preview:dontShowNotice"
/** Prefix for per-user preview identities (`preview-<email>`, see auth-options). */
export const PREVIEW_USER_PREFIX = "preview-"
/** Owner id backfilled onto pre-scoping rows. Reads never match it: archived. */
export const PREVIEW_LEGACY_USER_ID = "legacy"

/**
 * Server-side preview check (runtime-safe).
 *
 * Canonical switch is `PREVIEW=true` (see lib/config/env.ts): one flick that
 * makes every other variable resolve to canned preview defaults. The two
 * legacy flags are derived from it at the boundaries (Dockerfile, compose,
 * makefile, package.json) and remain supported directly.
 *
 * NEXT_PUBLIC_ vars are inlined at build time by Next.js, so a regular
 * `next build` followed by `next start` with the flag set at runtime would
 * still evaluate to false. PREVIEW_MODE is NOT inlined, so it works at
 * request time even when the build was not a preview build.
 */
export function isPreviewMode(): boolean {
  return (
    process.env.PREVIEW === "true" ||
    process.env.PREVIEW_MODE === "true" ||
    process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"
  )
}

export function isPreviewModeClient(): boolean {
  // NEXT_PUBLIC_ vars are inlined at build time; this helper centralizes the check
  return process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"
}

export function getPreviewPremium(userId?: string | null): boolean {
  if (typeof window === "undefined") return false
  try {
    if (userId) {
      const scopedKey = `${PREVIEW_PREMIUM_KEY}:${userId}`
      const scoped = localStorage.getItem(scopedKey)
      if (scoped !== null) return scoped === "true"
      // One-time adoption of a pre-scoping global flag, then drop it so it
      // can never leak into another user's scope.
      if (localStorage.getItem(PREVIEW_PREMIUM_KEY) === "true") {
        localStorage.setItem(scopedKey, "true")
        localStorage.removeItem(PREVIEW_PREMIUM_KEY)
        return true
      }
      return false
    }
    return localStorage.getItem(PREVIEW_PREMIUM_KEY) === "true"
  } catch {
    return false
  }
}

export function setPreviewPremium(value: boolean, userId?: string | null): void {
  if (typeof window === "undefined") return
  try {
    if (userId) {
      const scopedKey = `${PREVIEW_PREMIUM_KEY}:${userId}`
      if (value) localStorage.setItem(scopedKey, "true")
      else localStorage.removeItem(scopedKey)
      // A stale global flag must not be adoptable by another user later.
      localStorage.removeItem(PREVIEW_PREMIUM_KEY)
    } else if (value) {
      localStorage.setItem(PREVIEW_PREMIUM_KEY, "true")
    } else {
      localStorage.removeItem(PREVIEW_PREMIUM_KEY)
    }
    // Notify other tabs / components
    window.dispatchEvent(new CustomEvent("preview:premium-change", { detail: { isPremium: value } }))
  } catch {}
}

/**
 * Resolve the per-user preview scope from a session user.
 * Uses the session id directly (`preview-<email>`, assigned at authorize)
 * so client and server can never disagree on normalization.
 */
export function getPreviewUserId(user: { id?: string } | null | undefined): string | null {
  const id = user?.id
  if (
    typeof id === "string" &&
    id.startsWith(PREVIEW_USER_PREFIX) &&
    id.length > PREVIEW_USER_PREFIX.length
  ) {
    return id
  }
  return null
}

export function shouldShowPreviewNotice(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(PREVIEW_DONT_SHOW_NOTICE_KEY) !== "true"
  } catch {
    return true
  }
}

export function setPreviewDontShowNotice(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (value) localStorage.setItem(PREVIEW_DONT_SHOW_NOTICE_KEY, "true")
    else localStorage.removeItem(PREVIEW_DONT_SHOW_NOTICE_KEY)
  } catch {}
}
