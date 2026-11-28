import { parsePublicEnv, TEST_TURNSTILE_SITE_KEYS } from "./schema"

const parsed = parsePublicEnv({
  envType: process.env.NEXT_PUBLIC_ENV_TYPE,
  siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
})

const siteKey = parsed.siteKey.trim()

export const publicEnv = {
  envType: parsed.envType,
  turnstile: {
    siteKey,
    isTestKey: TEST_TURNSTILE_SITE_KEYS.has(siteKey),
  },
}
