import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

/**
 * Canonical preview switch. `PREVIEW=true` is the only flick preview mode
 * needs: validation is skipped and every variable below resolves to a canned
 * default (passed-in values are ignored), so no real credentials are
 * required. The backends behind these values are never dialed in preview —
 * all integrations are mocked — they only satisfy validation and types.
 *
 * Boundaries (Dockerfile, compose, makefile, package.json) derive the legacy
 * `PREVIEW_MODE` / `NEXT_PUBLIC_PREVIEW_MODE` flags from this switch, so the
 * direct `process.env.*` checks across the codebase keep working untouched.
 */
const isPreview = process.env.PREVIEW === "true"

const previewDefaults = {
  DATABASE_URL: "postgresql://preview:preview@localhost:5432/preview",
  DATABASE_URL_REPLICA: "postgresql://preview:preview@localhost:5432/preview",
  NEXTAUTH_SECRET: "preview-secret-for-preview-only-32chars",
  NEXTAUTH_URL: "http://localhost:3000",
  PREVIEW_MODE: "true",
  GOOGLE_ID: "mock-google-client-id-not-configured",
  GOOGLE_SECRET: "mock-google-client-secret-not-configured",
  GITHUB_ID: "mock-github-client-id-not-configured",
  GITHUB_SECRET: "mock-github-client-secret-not-configured",
  TURNSTILE_SECRET_KEY: "1x00000000000000000000AA",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "mock-paddle-client-token-not-configured",
  NEXT_PUBLIC_PREVIEW_MODE: "true",
  FILE_EXTRACTOR_API_URL: "http://localhost:8080",
  AI_SERVICE_URL: "localhost:50051",
  AI_SERVICE_API_KEY: "mock-ai-service-api-key-not-configured",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
} as const

/** Real value normally; canned preview default when `PREVIEW=true`. */
function pick(value: string | undefined, fallback: string): string | undefined {
  return isPreview ? fallback : value
}

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    DATABASE_URL_REPLICA: z.string().url().optional(),
    NEXTAUTH_SECRET: z.string().min(1),
    NEXTAUTH_URL: z.string().url().optional(),
    PREVIEW: z.enum(["true", "false"]).default("false"),
    PREVIEW_MODE: z.enum(["true", "false"]).default("false"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    GOOGLE_ID: z.string().min(1),
    GOOGLE_SECRET: z.string().min(1),
    GITHUB_ID: z.string().min(1),
    GITHUB_SECRET: z.string().min(1),
    TURNSTILE_SECRET_KEY: z.string().min(1),
    REDIS_URL: z.string().url(),
    REDIS_PASSWORD: z.string().optional(),
    FILE_EXTRACTOR_API_URL: z.string().url(),
    AI_SERVICE_URL: z.string().min(1),
    AI_SERVICE_API_KEY: z.string().min(1),
    CHAT_SERVICE_URL: z.string().min(1).default("localhost:50051"),
    PAYMENT_GATEWAY_URL: z.string().url().default("http://payment-gateway:8080"),
    INTERNAL_API_KEY: z.string().optional(),
    PROMETHEUS_WEB_SCRAPE_TOKEN: z.string().min(1).optional(),
    RABBITMQ_URL: z.string().url(),
  },
  client: {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z.string().min(1),
    NEXT_PUBLIC_PREVIEW_MODE: z.enum(["true", "false"]).default("false"),
  },
  runtimeEnv: {
    DATABASE_URL: pick(process.env.DATABASE_URL, previewDefaults.DATABASE_URL),
    DATABASE_URL_REPLICA: pick(process.env.DATABASE_URL_REPLICA, previewDefaults.DATABASE_URL_REPLICA),
    NEXTAUTH_SECRET: pick(process.env.NEXTAUTH_SECRET, previewDefaults.NEXTAUTH_SECRET),
    NEXTAUTH_URL: pick(process.env.NEXTAUTH_URL, previewDefaults.NEXTAUTH_URL),
    PREVIEW: process.env.PREVIEW,
    PREVIEW_MODE: pick(process.env.PREVIEW_MODE, previewDefaults.PREVIEW_MODE),
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    GOOGLE_ID: pick(process.env.GOOGLE_ID, previewDefaults.GOOGLE_ID),
    GOOGLE_SECRET: pick(process.env.GOOGLE_SECRET, previewDefaults.GOOGLE_SECRET),
    GITHUB_ID: pick(process.env.GITHUB_ID, previewDefaults.GITHUB_ID),
    GITHUB_SECRET: pick(process.env.GITHUB_SECRET, previewDefaults.GITHUB_SECRET),
    TURNSTILE_SECRET_KEY: pick(process.env.TURNSTILE_SECRET_KEY, previewDefaults.TURNSTILE_SECRET_KEY),
    REDIS_URL: process.env.REDIS_URL,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    FILE_EXTRACTOR_API_URL: pick(process.env.FILE_EXTRACTOR_API_URL, previewDefaults.FILE_EXTRACTOR_API_URL),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: pick(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, previewDefaults.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: pick(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN, previewDefaults.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN),
    NEXT_PUBLIC_PREVIEW_MODE: pick(process.env.NEXT_PUBLIC_PREVIEW_MODE, previewDefaults.NEXT_PUBLIC_PREVIEW_MODE),
    AI_SERVICE_URL: pick(process.env.AI_SERVICE_URL, previewDefaults.AI_SERVICE_URL),
    AI_SERVICE_API_KEY: pick(process.env.AI_SERVICE_API_KEY, previewDefaults.AI_SERVICE_API_KEY),
    CHAT_SERVICE_URL: process.env.CHAT_SERVICE_URL,
    PAYMENT_GATEWAY_URL: process.env.PAYMENT_GATEWAY_URL,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    PROMETHEUS_WEB_SCRAPE_TOKEN: process.env.PROMETHEUS_WEB_SCRAPE_TOKEN,
    RABBITMQ_URL: pick(process.env.RABBITMQ_URL, previewDefaults.RABBITMQ_URL),
  },
  skipValidation:
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.PREVIEW === "true" ||
    process.env.NEXT_PUBLIC_PREVIEW_MODE === "true" ||
    process.env.PREVIEW_MODE === "true",
  emptyStringAsUndefined: true,
})
