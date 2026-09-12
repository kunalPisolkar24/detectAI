import { z } from "zod"

const isValidRedisUrl = (value: string): boolean => {
  try {
    const u = new URL(value)
    return u.protocol === "redis:" || u.protocol === "rediss:"
  } catch {
    return false
  }
}

const isValidOtelUrl = (value: string): boolean => {
  if (!value) return true
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export const envTypeSchema = z.enum(["dev", "prod", "preview"]).default("dev")

export const serverSchema = z.object({
  ENV_TYPE: envTypeSchema,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_REPLICA: z.string().url().optional(),

  REDIS_URL: z.string().min(1).refine(isValidRedisUrl, {
    message: "REDIS_URL must be a valid redis:// or rediss:// URL",
  }),
  REDIS_PASSWORD: z.string().optional(),

  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url().optional(),

  GOOGLE_ID: z.string().min(1),
  GOOGLE_SECRET: z.string().min(1),
  GITHUB_ID: z.string().min(1),
  GITHUB_SECRET: z.string().min(1),

  TURNSTILE_SECRET_KEY: z.string().min(1),

  FILE_EXTRACTOR_API_URL: z.string().url(),
  AI_SERVICE_URL: z.string().min(1),
  AI_SERVICE_API_KEY: z.string().min(1),
  CHAT_SERVICE_URL: z.string().min(1).default("localhost:50051"),

  PAYMENT_GATEWAY_URL: z.string().url().default("http://payment-gateway:8080"),
  INTERNAL_API_KEY: z.string().optional(),

  RABBITMQ_URL: z.string().url(),

  PROMETHEUS_WEB_SCRAPE_TOKEN: z.string().min(1).optional(),

  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .optional()
    .refine((v) => !v || v === "" || isValidOtelUrl(v), {
      message: "OTEL_EXPORTER_OTLP_ENDPOINT must be http(s) URL",
    }),
  OTEL_SERVICE_NAME: z.string().optional().default("web"),

  AWS_REGION: z.string().optional().default("ap-south-1"),
})

export const clientSchema = z.object({
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1),
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z.string().min(1),
  NEXT_PUBLIC_ENV_TYPE: z.enum(["dev", "prod", "preview"]).default("dev"),
  NEXT_PUBLIC_PREVIEW_MODE: z.enum(["true", "false"]).optional(),
})

export const fullSchema = serverSchema.merge(clientSchema)

export type ServerConfig = z.infer<typeof serverSchema>
export type ClientConfig = z.infer<typeof clientSchema>
export type FullConfig = z.infer<typeof fullSchema>

export const previewDefaults = {
  DATABASE_URL: "postgresql://preview:preview@localhost:5432/preview",
  DATABASE_URL_REPLICA: "postgresql://preview:preview@localhost:5432/preview",
  REDIS_URL: "redis://:preview@localhost:6379",
  REDIS_PASSWORD: "preview",
  NEXTAUTH_SECRET: "preview-secret-for-preview-only-32chars",
  NEXTAUTH_URL: "http://localhost:3000",
  GOOGLE_ID: "mock-google-client-id-not-configured",
  GOOGLE_SECRET: "mock-google-client-secret-not-configured",
  GITHUB_ID: "mock-github-client-id-not-configured",
  GITHUB_SECRET: "mock-github-client-secret-not-configured",
  TURNSTILE_SECRET_KEY: "1x00000000000000000000AA",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "mock-paddle-client-token-not-configured",
  NEXT_PUBLIC_ENV_TYPE: "preview" as const,
  NEXT_PUBLIC_PREVIEW_MODE: "true" as const,
  FILE_EXTRACTOR_API_URL: "http://localhost:8080",
  AI_SERVICE_URL: "localhost:50051",
  AI_SERVICE_API_KEY: "mock-ai-service-api-key-not-configured",
  CHAT_SERVICE_URL: "localhost:50051",
  PAYMENT_GATEWAY_URL: "http://localhost:8080",
  INTERNAL_API_KEY: "preview-internal-key-not-configured",
  RABBITMQ_URL: "amqp://guest:guest@localhost:5672",
  DB_POOL_MAX: 5,
  OTEL_EXPORTER_OTLP_ENDPOINT: "",
  OTEL_SERVICE_NAME: "web",
  AWS_REGION: "ap-south-1",
  LOG_LEVEL: "info" as const,
  NODE_ENV: "development" as const,
} as const
