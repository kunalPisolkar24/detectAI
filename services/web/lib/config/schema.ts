import { z } from "zod"

export const envTypeSchema = z.enum(["dev", "prod", "preview"]).default("dev")

export type EnvType = z.infer<typeof envTypeSchema>

export const publicSchema = z.object({
  envType: envTypeSchema,
  siteKey: z.string().min(1),
})

export const serverSchema = z.object({
  envType: envTypeSchema,
  authSecret: z.string().min(32),
  authUrl: z.url().optional(),
  githubId: z.string().min(1),
  githubSecret: z.string().min(1),
  googleId: z.string().min(1),
  googleSecret: z.string().min(1),
  turnstileSecretKey: z.string().min(1),
  usersServiceUrl: z.url(),
  usersServiceApiKey: z.string().min(1),
})

export type PublicConfig = z.infer<typeof publicSchema>
export type ServerConfig = z.infer<typeof serverSchema>

const PREVIEW_SITE_KEY = "1x00000000000000000000AA"
const PREVIEW_SECRET_KEY = "1x0000000000000000000000000000000AA"
const DEV_AUTH_SECRET = "dev-auth-secret-not-for-production-32chars"
const PREVIEW_AUTH_SECRET = "preview-auth-secret-not-for-production-32chars"

export const TEST_TURNSTILE_SITE_KEYS = new Set([
  PREVIEW_SITE_KEY,
  "mock-turnstile-site-key-not-configured",
  "dummy",
])

const TEST_TURNSTILE_SECRET_KEYS = new Set([PREVIEW_SECRET_KEY])
const KNOWN_DEV_AUTH_SECRETS = new Set([DEV_AUTH_SECRET, PREVIEW_AUTH_SECRET])

type ServerInput = Omit<ServerConfig, "envType"> & { envType?: EnvType }

const devDefaults: ServerInput = {
  authSecret: DEV_AUTH_SECRET,
  authUrl: "http://localhost:3000",
  githubId: "dev-github-client-id",
  githubSecret: "dev-github-client-secret",
  googleId: "dev-google-client-id",
  googleSecret: "dev-google-client-secret",
  turnstileSecretKey: PREVIEW_SECRET_KEY,
  usersServiceUrl: "http://localhost:8090",
  usersServiceApiKey: "local-dev-api-key-16-chars",
}

const previewDefaults: ServerInput = {
  authSecret: PREVIEW_AUTH_SECRET,
  authUrl: "http://localhost:3000",
  githubId: "preview-github-client-id",
  githubSecret: "preview-github-client-secret",
  googleId: "preview-google-client-id",
  googleSecret: "preview-google-client-secret",
  turnstileSecretKey: PREVIEW_SECRET_KEY,
  usersServiceUrl: "http://localhost:8090",
  usersServiceApiKey: "preview-users-service-api-key",
}

export type RawPublicEnv = {
  envType: string | undefined
  siteKey: string | undefined
}

export type RawServerEnv = {
  envType: string | undefined
  authSecret: string | undefined
  authUrl: string | undefined
  githubId: string | undefined
  githubSecret: string | undefined
  googleId: string | undefined
  googleSecret: string | undefined
  turnstileSecretKey: string | undefined
  usersServiceUrl: string | undefined
  usersServiceApiKey: string | undefined
}

export function parsePublicEnv(raw: RawPublicEnv): PublicConfig {
  const envType = envTypeSchema.parse(raw.envType)

  return publicSchema.parse({
    envType,
    siteKey: raw.siteKey ?? (envType === "prod" ? undefined : PREVIEW_SITE_KEY),
  })
}

function assertDeploymentGuards(config: ServerConfig, vercelEnv: string | undefined): void {
  const problems: string[] = []

  if (vercelEnv === "production" && config.envType !== "prod") {
    problems.push("NEXT_PUBLIC_ENV_TYPE must be prod when VERCEL_ENV is production")
  }
  if (vercelEnv === "preview" && config.envType !== "preview") {
    problems.push("NEXT_PUBLIC_ENV_TYPE must be preview when VERCEL_ENV is preview")
  }

  if (config.envType === "prod") {
    if (TEST_TURNSTILE_SECRET_KEYS.has(config.turnstileSecretKey)) {
      problems.push("TURNSTILE_SECRET_KEY must not be a test key in prod")
    }
    if (config.authSecret.length < 32 || KNOWN_DEV_AUTH_SECRETS.has(config.authSecret)) {
      problems.push("AUTH_SECRET must be a real secret in prod")
    }
  }

  if (problems.length > 0) {
    throw new Error(`Invalid web configuration:\n- ${problems.join("\n- ")}`)
  }
}

export function parseServerEnv(raw: RawServerEnv, vercelEnv?: string): ServerConfig {
  const envType = envTypeSchema.parse(raw.envType)
  const defaults = envType === "dev" ? devDefaults : envType === "preview" ? previewDefaults : undefined

  const config = serverSchema.parse({
    envType,
    authSecret: raw.authSecret ?? defaults?.authSecret,
    authUrl: raw.authUrl ?? defaults?.authUrl,
    githubId: raw.githubId ?? defaults?.githubId,
    githubSecret: raw.githubSecret ?? defaults?.githubSecret,
    googleId: raw.googleId ?? defaults?.googleId,
    googleSecret: raw.googleSecret ?? defaults?.googleSecret,
    turnstileSecretKey: raw.turnstileSecretKey ?? defaults?.turnstileSecretKey,
    usersServiceUrl: raw.usersServiceUrl ?? defaults?.usersServiceUrl,
    usersServiceApiKey: raw.usersServiceApiKey ?? defaults?.usersServiceApiKey,
  })

  assertDeploymentGuards(config, vercelEnv)
  return config
}
