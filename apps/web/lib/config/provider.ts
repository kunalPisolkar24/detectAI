import type { FullConfig } from "./schema"
import { fullSchema, previewDefaults } from "./schema"
import { loadFromAWS } from "./aws"

let cachedConfig: FullConfig | null = null
let initPromise: Promise<FullConfig> | null = null

function envOr(key: string, fallback: string): string {
  const v = process.env[key]
  return v !== undefined && v !== "" ? v : fallback
}

export function resolveEnvType(): "dev" | "prod" | "preview" {
  const raw = process.env.ENV_TYPE?.toLowerCase().trim()
  if (raw === "dev" || raw === "prod" || raw === "preview") return raw
  if (raw === "production") return "prod"
  if (raw === "development") return "dev"
  if (raw === "test") return "dev"

  const legacyPreview =
    process.env.PREVIEW?.toLowerCase().trim() === "true" ||
    process.env.PREVIEW_MODE?.toLowerCase().trim() === "true" ||
    process.env.NEXT_PUBLIC_PREVIEW_MODE?.toLowerCase().trim() === "true"
  if (legacyPreview) {
    console.warn("PREVIEW/PREVIEW_MODE is deprecated, use ENV_TYPE=preview")
    return "preview"
  }

  const legacy = process.env.CONFIG_SOURCE?.toLowerCase().trim()
  if (legacy) {
    console.warn("CONFIG_SOURCE is deprecated, use ENV_TYPE=dev|prod|preview", { value: legacy })
    if (legacy === "aws" || legacy === "prod") return "prod"
    if (legacy === "env" || legacy === "dev") return "dev"
  }

  const nodeEnv = process.env.NODE_ENV?.toLowerCase().trim()
  if (nodeEnv === "production") return "prod"
  return "dev"
}

function applyPreviewDefaults(cfg: Record<string, string>): void {
  for (const [k, v] of Object.entries(previewDefaults)) {
    if (!cfg[k]) cfg[k] = String(v)
  }
  cfg.ENV_TYPE = "preview"
  cfg.NEXT_PUBLIC_ENV_TYPE = "preview"
  cfg.NEXT_PUBLIC_PREVIEW_MODE = "true"
}

function applyDevDefaults(cfg: Record<string, string>): void {
  if (!cfg.DATABASE_URL) cfg.DATABASE_URL = "postgresql://user:password@postgres-users:5432/detect_ai"
  if (!cfg.DATABASE_URL_REPLICA) cfg.DATABASE_URL_REPLICA = cfg.DATABASE_URL
  if (!cfg.REDIS_URL) cfg.REDIS_URL = "redis://:user_cache_password@redis-users:6379"
  if (!cfg.REDIS_PASSWORD) cfg.REDIS_PASSWORD = "user_cache_password"
  if (!cfg.NEXTAUTH_SECRET) cfg.NEXTAUTH_SECRET = "change-me-to-a-random-32-char-string"
  if (!cfg.NEXTAUTH_URL) cfg.NEXTAUTH_URL = "http://localhost:3000"
  if (!cfg.GOOGLE_ID) cfg.GOOGLE_ID = "mock-google-client-id-not-configured"
  if (!cfg.GOOGLE_SECRET) cfg.GOOGLE_SECRET = "mock-google-client-secret-not-configured"
  if (!cfg.GITHUB_ID) cfg.GITHUB_ID = "mock-github-client-id-not-configured"
  if (!cfg.GITHUB_SECRET) cfg.GITHUB_SECRET = "mock-github-client-secret-not-configured"
  if (!cfg.TURNSTILE_SECRET_KEY) cfg.TURNSTILE_SECRET_KEY = "1x00000000000000000000AA"
  if (!cfg.NEXT_PUBLIC_TURNSTILE_SITE_KEY) cfg.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA"
  if (!cfg.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN) cfg.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN = "mock-paddle-client-token-not-configured"
  if (!cfg.FILE_EXTRACTOR_API_URL) cfg.FILE_EXTRACTOR_API_URL = "http://document-parser:8000"
  if (!cfg.AI_SERVICE_URL) cfg.AI_SERVICE_URL = "ai-service:50051"
  if (!cfg.AI_SERVICE_API_KEY) cfg.AI_SERVICE_API_KEY = "dev-secret-key"
  if (!cfg.CHAT_SERVICE_URL) cfg.CHAT_SERVICE_URL = "chat-service:50051"
  if (!cfg.PAYMENT_GATEWAY_URL) cfg.PAYMENT_GATEWAY_URL = "http://payment-gateway:8080"
  if (!cfg.INTERNAL_API_KEY) cfg.INTERNAL_API_KEY = "internal-secret-key"
  if (!cfg.RABBITMQ_URL) cfg.RABBITMQ_URL = "amqp://guest:guest@rabbitmq:5672/"
  if (!cfg.DB_POOL_MAX && process.env.POOL_MAX) cfg.DB_POOL_MAX = process.env.POOL_MAX
  if (!cfg.DB_POOL_MAX) cfg.DB_POOL_MAX = "5"
  if (!cfg.AWS_REGION) cfg.AWS_REGION = envOr("AWS_REGION", "ap-south-1")
  if (!cfg.OTEL_SERVICE_NAME) cfg.OTEL_SERVICE_NAME = envOr("OTEL_SERVICE_NAME", "web")
  if (!cfg.OTEL_EXPORTER_OTLP_ENDPOINT) cfg.OTEL_EXPORTER_OTLP_ENDPOINT = envOr("OTEL_EXPORTER_OTLP_ENDPOINT", "")
  if (!cfg.LOG_LEVEL) cfg.LOG_LEVEL = envOr("LOG_LEVEL", "info")
  if (!cfg.NODE_ENV) cfg.NODE_ENV = envOr("NODE_ENV", "development")
  cfg.ENV_TYPE = "dev"
  if (!cfg.NEXT_PUBLIC_ENV_TYPE) cfg.NEXT_PUBLIC_ENV_TYPE = "dev"
  if (!cfg.NEXT_PUBLIC_PREVIEW_MODE) cfg.NEXT_PUBLIC_PREVIEW_MODE = "false"
}

function loadProdNonSecretOverrides(cfg: Record<string, string>): void {
  const keys = [
    "NEXTAUTH_URL",
    "LOG_LEVEL",
    "NODE_ENV",
    "DB_POOL_MAX",
    "POOL_MAX",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
    "PAYMENT_GATEWAY_URL",
    "FILE_EXTRACTOR_API_URL",
    "AI_SERVICE_URL",
    "CHAT_SERVICE_URL",
    "AWS_REGION",
    "NEXT_PUBLIC_ENV_TYPE",
    "NEXT_PUBLIC_PREVIEW_MODE",
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
  ]
  for (const key of keys) {
    const v = process.env[key]
    if (v !== undefined && v !== "" && !cfg[key]) cfg[key] = v
  }
  if (cfg.POOL_MAX && !cfg.DB_POOL_MAX) cfg.DB_POOL_MAX = cfg.POOL_MAX
  if (!cfg.AWS_REGION) cfg.AWS_REGION = envOr("AWS_REGION", "ap-south-1")
  if (!cfg.NEXT_PUBLIC_ENV_TYPE) cfg.NEXT_PUBLIC_ENV_TYPE = "prod"
  if (!cfg.NEXT_PUBLIC_PREVIEW_MODE) cfg.NEXT_PUBLIC_PREVIEW_MODE = "false"
}

function isMockValue(v: string): boolean {
  return v.includes("mock-") && v.includes("not-configured")
}

function isDefaultDevUrl(v: string): boolean {
  const lower = v.toLowerCase()
  return (
    lower.includes("guest:guest@rabbitmq") ||
    lower.includes("guest:guest@localhost") ||
    lower.includes("user_cache_password@redis-users") ||
    lower.includes("postgres-users:5432") ||
    lower.includes("localhost:5432/preview") ||
    lower.includes("preview:preview@")
  )
}

function validateProdStrict(cfg: FullConfig): void {
  if (!cfg.AWS_REGION || cfg.AWS_REGION.trim() === "") {
    throw new Error("ENV_TYPE=prod requires AWS_REGION")
  }

  const mustBeReal: Array<[keyof FullConfig, string]> = [
    ["DATABASE_URL", "DATABASE_URL"],
    ["REDIS_URL", "REDIS_URL"],
    ["NEXTAUTH_SECRET", "NEXTAUTH_SECRET"],
    ["RABBITMQ_URL", "RABBITMQ_URL"],
    ["TURNSTILE_SECRET_KEY", "TURNSTILE_SECRET_KEY"],
    ["AI_SERVICE_API_KEY", "AI_SERVICE_API_KEY"],
  ]
  const missing: string[] = []
  for (const [key, label] of mustBeReal) {
    const v = String((cfg as Record<string, unknown>)[key as string] ?? "")
    if (!v || v.trim() === "") missing.push(label)
  }
  if (missing.length) {
    throw new Error(`ENV_TYPE=prod missing required keys: ${missing.join(", ")} (from AWS detectai/pg/urls, detectai/redis/users/urls, detectai/mq/urls, detectai/web/secrets or SSM /detectai/web/)`)
  }

  if (isDefaultDevUrl(cfg.DATABASE_URL) || cfg.DATABASE_URL.includes("preview:preview")) {
    throw new Error("ENV_TYPE=prod must not use default dev/preview DATABASE_URL")
  }
  if (isDefaultDevUrl(cfg.REDIS_URL) || cfg.REDIS_URL === "redis://:preview@localhost:6379") {
    throw new Error("ENV_TYPE=prod must not use default dev/preview REDIS_URL")
  }
  if (isDefaultDevUrl(cfg.RABBITMQ_URL) || cfg.RABBITMQ_URL.includes("guest:guest@rabbitmq") || cfg.RABBITMQ_URL.includes("guest:guest@localhost")) {
    throw new Error("ENV_TYPE=prod must not use default dev RabbitMQ URL (guest:guest)")
  }
  if (isMockValue(cfg.NEXTAUTH_SECRET) || cfg.NEXTAUTH_SECRET.length < 16) {
    throw new Error("ENV_TYPE=prod requires a real NEXTAUTH_SECRET ( >=16 chars, not mock)")
  }
  if (isMockValue(cfg.GOOGLE_ID) || isMockValue(cfg.GOOGLE_SECRET) || isMockValue(cfg.GITHUB_ID) || isMockValue(cfg.GITHUB_SECRET)) {
    throw new Error("ENV_TYPE=prod must not use mock OAuth credentials (GOOGLE_ID/SECRET, GITHUB_ID/SECRET)")
  }
  if (isMockValue(cfg.TURNSTILE_SECRET_KEY) && cfg.TURNSTILE_SECRET_KEY === "1x00000000000000000000AA") {
    throw new Error("ENV_TYPE=prod must not use test Turnstile secret key")
  }
  if (cfg.INTERNAL_API_KEY && cfg.INTERNAL_API_KEY.length < 16) {
    throw new Error("INTERNAL_API_KEY must be at least 16 characters in prod")
  }
  if (cfg.PROMETHEUS_WEB_SCRAPE_TOKEN && cfg.PROMETHEUS_WEB_SCRAPE_TOKEN.length < 16) {
    throw new Error("PROMETHEUS_WEB_SCRAPE_TOKEN must be at least 16 characters if set")
  }
  if (isMockValue(cfg.AI_SERVICE_API_KEY)) {
    throw new Error("ENV_TYPE=prod must not use mock AI_SERVICE_API_KEY")
  }
}

async function buildConfig(): Promise<FullConfig> {
  const envType = resolveEnvType()

  if (envType !== "dev" && envType !== "prod" && envType !== "preview") {
    throw new Error(`ENV_TYPE must be dev, prod or preview, got "${envType}"`)
  }

  const cfg: Record<string, string> = {}

  if (envType === "preview") {
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) cfg[k] = v
    applyPreviewDefaults(cfg)
  } else if (envType === "dev") {
    try {
      const fs = await import("node:fs")
      const hasEnvFile = fs.existsSync(".env")
      if (hasEnvFile) {
        const dotenv = await import("dotenv")
        dotenv.config()
      } else if (process.env.ENV_FILE) {
        const dotenv = await import("dotenv")
        dotenv.config({ path: process.env.ENV_FILE })
      }
    } catch {
    }
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) cfg[k] = v
    cfg.ENV_TYPE = "dev"
    applyDevDefaults(cfg)
  } else {
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) cfg[k] = v
    cfg.ENV_TYPE = "prod"
    await loadFromAWS(cfg)
    loadProdNonSecretOverrides(cfg)
  }

  const merged: Record<string, string | undefined> = { ...process.env, ...cfg }
  merged.ENV_TYPE = envType
  if (!merged.NEXT_PUBLIC_ENV_TYPE) merged.NEXT_PUBLIC_ENV_TYPE = envType
  if (!merged.NEXT_PUBLIC_PREVIEW_MODE) merged.NEXT_PUBLIC_PREVIEW_MODE = envType === "preview" ? "true" : "false"

  const result = fullSchema.safeParse(merged)
  if (!result.success) {
    const errs = result.error.format()
    console.error(`Invalid environment variables for [web] (ENV_TYPE=${envType})`, errs)
    throw new Error(`Invalid environment variables for [web]: ${result.error.message}`)
  }

  const validated = result.data as FullConfig

  if (envType === "prod") {
    try {
      validateProdStrict(validated)
    } catch (e) {
      console.error(`Prod strict validation failed for [web]`, e)
      throw e
    }
  }

  for (const [k, v] of Object.entries(validated)) {
    if (v !== undefined && process.env[k] === undefined) process.env[k] = String(v)
  }
  process.env.ENV_TYPE = envType
  process.env.NEXT_PUBLIC_ENV_TYPE = validated.NEXT_PUBLIC_ENV_TYPE
  if (validated.NEXT_PUBLIC_PREVIEW_MODE) process.env.NEXT_PUBLIC_PREVIEW_MODE = validated.NEXT_PUBLIC_PREVIEW_MODE

  return validated
}

export async function initConfig(): Promise<FullConfig> {
  if (cachedConfig) return cachedConfig
  if (initPromise) return initPromise
  initPromise = buildConfig()
    .then((cfg) => {
      cachedConfig = cfg
      return cfg
    })
    .catch((err) => {
      initPromise = null
      throw err
    })
  return initPromise
}

export function getConfig(): FullConfig {
  if (cachedConfig) return cachedConfig
  const envType = resolveEnvType()
  if (envType === "prod") {
    const mergedProd: Record<string, string | undefined> = { ...process.env, ENV_TYPE: "prod" }
    if (!mergedProd.NEXT_PUBLIC_ENV_TYPE) mergedProd.NEXT_PUBLIC_ENV_TYPE = "prod"
    if (!mergedProd.NEXT_PUBLIC_PREVIEW_MODE) mergedProd.NEXT_PUBLIC_PREVIEW_MODE = "false"
    const prodResult = fullSchema.safeParse(mergedProd)
    if (prodResult.success) {
      try {
        validateProdStrict(prodResult.data as FullConfig)
        cachedConfig = prodResult.data as FullConfig
        return cachedConfig
      } catch {
      }
    }
    throw new Error("Config not initialized: call await initConfig() in instrumentation.ts before accessing env in prod")
  }
  const merged: Record<string, string | undefined> = { ...process.env }
  merged.ENV_TYPE = envType
  if (!merged.NEXT_PUBLIC_ENV_TYPE) merged.NEXT_PUBLIC_ENV_TYPE = envType
  if (!merged.NEXT_PUBLIC_PREVIEW_MODE) merged.NEXT_PUBLIC_PREVIEW_MODE = envType === "preview" ? "true" : "false"

  if (envType === "preview") {
    for (const [k, v] of Object.entries(previewDefaults)) if (!merged[k]) merged[k] = String(v)
    merged.ENV_TYPE = "preview"
    merged.NEXT_PUBLIC_ENV_TYPE = "preview"
    merged.NEXT_PUBLIC_PREVIEW_MODE = "true"
  } else if (envType === "dev") {
    const devCfg: Record<string, string> = {}
    for (const [k, v] of Object.entries(merged)) if (v !== undefined) devCfg[k] = v
    applyDevDefaults(devCfg)
    for (const [k, v] of Object.entries(devCfg)) if (!merged[k]) merged[k] = v
  }

  const result = fullSchema.safeParse(merged)
  if (!result.success) {
    console.error(`Invalid environment variables for [web] (ENV_TYPE=${envType})`, result.error.format())
    throw new Error(`Invalid environment variables for [web]: ${result.error.message}`)
  }
  cachedConfig = result.data as FullConfig
  return cachedConfig
}

export function resetConfigForTests(): void {
  cachedConfig = null
  initPromise = null
}

export function getEnvType(): "dev" | "prod" | "preview" {
  if (cachedConfig) return cachedConfig.ENV_TYPE
  return resolveEnvType()
}

export function isPreview(): boolean {
  return getEnvType() === "preview"
}

export function isProd(): boolean {
  return getEnvType() === "prod"
}

export function isDev(): boolean {
  return getEnvType() === "dev"
}
