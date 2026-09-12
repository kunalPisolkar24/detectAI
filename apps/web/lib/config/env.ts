import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"
import { getConfig } from "./provider"
import { previewDefaults } from "./schema"

// Keep @t3-oss/env-nextjs for Next.js inlining of NEXT_PUBLIC_*.
// Server values are sourced from the validated provider (AWS in prod, dev defaults locally).
// This file is the single public import: `import { env } from "@/lib/config/env"`.

function isPreviewRaw(): boolean {
  return process.env.ENV_TYPE === "preview" || process.env.PREVIEW === "true"
}

const serverEnvForT3: Record<string, z.ZodTypeAny> = {
  DATABASE_URL: z.string().url(),
  DATABASE_URL_REPLICA: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  GOOGLE_ID: z.string().min(1),
  GOOGLE_SECRET: z.string().min(1),
  GITHUB_ID: z.string().min(1),
  GITHUB_SECRET: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  REDIS_PASSWORD: z.string().optional(),
  FILE_EXTRACTOR_API_URL: z.string().url(),
  AI_SERVICE_URL: z.string().min(1),
  AI_SERVICE_API_KEY: z.string().min(1),
  CHAT_SERVICE_URL: z.string().min(1).default("localhost:50051"),
  PAYMENT_GATEWAY_URL: z.string().url().default("http://payment-gateway:8080"),
  INTERNAL_API_KEY: z.string().optional(),
  RABBITMQ_URL: z.string().url(),
  PROMETHEUS_WEB_SCRAPE_TOKEN: z.string().min(1).optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  AWS_REGION: z.string().optional(),
  ENV_TYPE: z.enum(["dev", "prod", "preview"]).default("dev"),
}

const clientEnvForT3 = {
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z.string().min(1),
  NEXT_PUBLIC_ENV_TYPE: z.enum(["dev", "prod", "preview"]).default("dev"),
  NEXT_PUBLIC_PREVIEW_MODE: z.enum(["true", "false"]).optional(),
}

function pickPreview(value: string | undefined, fallback: string): string | undefined {
  return isPreviewRaw() ? fallback : value
}

const t3Env = createEnv({
  server: serverEnvForT3,
  client: clientEnvForT3,
  runtimeEnv: {
    DATABASE_URL: pickPreview(process.env.DATABASE_URL, previewDefaults.DATABASE_URL),
    DATABASE_URL_REPLICA: pickPreview(process.env.DATABASE_URL_REPLICA, previewDefaults.DATABASE_URL_REPLICA),
    NEXTAUTH_SECRET: pickPreview(process.env.NEXTAUTH_SECRET, previewDefaults.NEXTAUTH_SECRET),
    NEXTAUTH_URL: pickPreview(process.env.NEXTAUTH_URL, previewDefaults.NEXTAUTH_URL),
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    GOOGLE_ID: pickPreview(process.env.GOOGLE_ID, previewDefaults.GOOGLE_ID),
    GOOGLE_SECRET: pickPreview(process.env.GOOGLE_SECRET, previewDefaults.GOOGLE_SECRET),
    GITHUB_ID: pickPreview(process.env.GITHUB_ID, previewDefaults.GITHUB_ID),
    GITHUB_SECRET: pickPreview(process.env.GITHUB_SECRET, previewDefaults.GITHUB_SECRET),
    TURNSTILE_SECRET_KEY: pickPreview(process.env.TURNSTILE_SECRET_KEY, previewDefaults.TURNSTILE_SECRET_KEY),
    REDIS_URL: process.env.REDIS_URL ?? (isPreviewRaw() ? previewDefaults.REDIS_URL : undefined),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? (isPreviewRaw() ? previewDefaults.REDIS_PASSWORD : undefined),
    FILE_EXTRACTOR_API_URL: pickPreview(process.env.FILE_EXTRACTOR_API_URL, previewDefaults.FILE_EXTRACTOR_API_URL),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: pickPreview(
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      previewDefaults.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    ),
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: pickPreview(
      process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
      previewDefaults.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
    ),
    NEXT_PUBLIC_ENV_TYPE: process.env.NEXT_PUBLIC_ENV_TYPE ?? (isPreviewRaw() ? "preview" : process.env.ENV_TYPE),
    NEXT_PUBLIC_PREVIEW_MODE: process.env.NEXT_PUBLIC_PREVIEW_MODE ?? (isPreviewRaw() ? "true" : "false"),
    AI_SERVICE_URL: pickPreview(process.env.AI_SERVICE_URL, previewDefaults.AI_SERVICE_URL),
    AI_SERVICE_API_KEY: pickPreview(process.env.AI_SERVICE_API_KEY, previewDefaults.AI_SERVICE_API_KEY),
    CHAT_SERVICE_URL: process.env.CHAT_SERVICE_URL ?? (isPreviewRaw() ? previewDefaults.CHAT_SERVICE_URL : undefined),
    PAYMENT_GATEWAY_URL: process.env.PAYMENT_GATEWAY_URL,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    PROMETHEUS_WEB_SCRAPE_TOKEN: process.env.PROMETHEUS_WEB_SCRAPE_TOKEN,
    DB_POOL_MAX: process.env.DB_POOL_MAX ?? process.env.POOL_MAX,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    AWS_REGION: process.env.AWS_REGION,
    RABBITMQ_URL: pickPreview(process.env.RABBITMQ_URL, previewDefaults.RABBITMQ_URL),
    ENV_TYPE: process.env.ENV_TYPE,
  },
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.ENV_TYPE === "preview" ||
    process.env.PREVIEW === "true" ||
    process.env.NEXT_PUBLIC_PREVIEW_MODE === "true" ||
    process.env.PREVIEW_MODE === "true" ||
    process.env.ENV_TYPE === "prod",
  emptyStringAsUndefined: true,
})

type EnvType = typeof t3Env & ReturnType<typeof getConfig>

const handler: ProxyHandler<EnvType> = {
  get(_target, prop: string | symbol) {
    if (typeof prop !== "string") return undefined

    const isServerKey =
      prop in serverEnvForT3 ||
      prop === "ENV_TYPE" ||
      prop === "DB_POOL_MAX" ||
      prop === "AWS_REGION" ||
      prop === "OTEL_EXPORTER_OTLP_ENDPOINT" ||
      prop === "OTEL_SERVICE_NAME"

    if (isServerKey) {
      if (typeof window !== "undefined") {
        throw new Error(`[env] Server key "${prop}" accessed on client`)
      }
      try {
        const cfg = getConfig()
        if (prop in cfg) return (cfg as Record<string, unknown>)[prop]
      } catch {
      }
      return (t3Env as Record<string, unknown>)[prop]
    }

    if (prop.startsWith("NEXT_PUBLIC_")) {
      return (t3Env as Record<string, unknown>)[prop]
    }

    try {
      const cfg = getConfig()
      if (prop in cfg) return (cfg as Record<string, unknown>)[prop]
    } catch {
    }
    return (t3Env as Record<string, unknown>)[prop]
  },
}

export const env = new Proxy(t3Env as EnvType, handler)
