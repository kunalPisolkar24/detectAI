export const PREVIEW_TOOLTIP = "Not available in preview mode"
export const DOCUMENT_PARSER_UNAVAILABLE_TOOLTIP = "Document parsing is temporarily unavailable"
export const PAYMENT_GATEWAY_UNAVAILABLE_TOOLTIP = "Payments temporarily unavailable"
export const ANALYSIS_SERVICE_UNAVAILABLE_TOOLTIP = "Analysis service temporarily unavailable"
export const PREVIEW_PREMIUM_KEY = "preview:isPremium"
export const PREVIEW_DONT_SHOW_NOTICE_KEY = "preview:dontShowNotice"
export const PREVIEW_USER_PREFIX = "preview-"
export const PREVIEW_LEGACY_USER_ID = "legacy"

function getEnvType(): string | undefined {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_ENV_TYPE
  }
  return process.env.ENV_TYPE ?? process.env.NEXT_PUBLIC_ENV_TYPE
}

function isLegacyPreview(): boolean {
  return (
    process.env.PREVIEW === "true" ||
    process.env.PREVIEW_MODE === "true" ||
    process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"
  )
}

export function isPreviewMode(): boolean {
  const t = getEnvType()
  if (t === "preview") return true
  if (t === "dev" || t === "prod") return false
  return isLegacyPreview()
}

export function isPreviewModeClient(): boolean {
  if (process.env.NEXT_PUBLIC_ENV_TYPE === "preview") return true
  if (process.env.NEXT_PUBLIC_ENV_TYPE === "dev" || process.env.NEXT_PUBLIC_ENV_TYPE === "prod") return false
  return process.env.NEXT_PUBLIC_PREVIEW_MODE === "true" || isLegacyPreview()
}

export function getPreviewPremium(userId?: string | null): boolean {
  if (typeof window === "undefined") return false
  try {
    if (userId) {
      const scopedKey = `${PREVIEW_PREMIUM_KEY}:${userId}`
      const scoped = localStorage.getItem(scopedKey)
      if (scoped !== null) return scoped === "true"
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
      localStorage.removeItem(PREVIEW_PREMIUM_KEY)
    } else if (value) {
      localStorage.setItem(PREVIEW_PREMIUM_KEY, "true")
    } else {
      localStorage.removeItem(PREVIEW_PREMIUM_KEY)
    }
    window.dispatchEvent(new CustomEvent("preview:premium-change", { detail: { isPremium: value } }))
  } catch {}
}

export function getPreviewUserId(user: { id?: string } | null | undefined): string | null {
  const id = user?.id
  if (typeof id === "string" && id.startsWith(PREVIEW_USER_PREFIX) && id.length > PREVIEW_USER_PREFIX.length) {
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
