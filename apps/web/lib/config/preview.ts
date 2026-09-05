export const PREVIEW_TOOLTIP = "Not available in preview mode"
export const PREVIEW_PREMIUM_KEY = "preview:isPremium"
export const PREVIEW_DONT_SHOW_NOTICE_KEY = "preview:dontShowNotice"
export const PREVIEW_FLAG = "NEXT_PUBLIC_PREVIEW_MODE"
export const PREVIEW_SERVER_FLAG = "PREVIEW_MODE"

/**
 * Server-side preview check (runtime-safe).
 *
 * NEXT_PUBLIC_ vars are inlined at build time by Next.js, so a regular
 * `next build` followed by `next start` with the flag set at runtime would
 * still evaluate to false. PREVIEW_MODE is NOT inlined, so it works at
 * request time even when the build was not a preview build.
 */
export function isPreviewMode(): boolean {
  return process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"
}

export function isPreviewModeClient(): boolean {
  // NEXT_PUBLIC_ vars are inlined at build time; this helper centralizes the check
  return process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"
}

export function getPreviewPremium(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(PREVIEW_PREMIUM_KEY) === "true"
  } catch {
    return false
  }
}

export function setPreviewPremium(value: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (value) localStorage.setItem(PREVIEW_PREMIUM_KEY, "true")
    else localStorage.removeItem(PREVIEW_PREMIUM_KEY)
    // Notify other tabs / components
    window.dispatchEvent(new CustomEvent("preview:premium-change", { detail: { isPremium: value } }))
  } catch {}
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
