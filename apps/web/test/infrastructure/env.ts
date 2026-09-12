import { vi } from 'vitest'

export const setupEnvMocks = () => {
  vi.mock('@/lib/config/env', () => ({
    env: {
      ENV_TYPE: 'dev',
      NEXT_PUBLIC_ENV_TYPE: 'dev',
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DATABASE_URL_REPLICA: 'postgresql://user:pass@localhost:5432/db',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key',
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test-paddle-token',
      TURNSTILE_SECRET_KEY: 'test-secret-key',
      FILE_EXTRACTOR_API_URL: 'http://localhost:8000',
      AI_SERVICE_URL: 'localhost:50051',
      AI_SERVICE_API_KEY: 'test-api-key',
      CHAT_SERVICE_URL: 'localhost:50051',
      INFERENCE_SERVICE_URL: 'localhost:50051',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_PASSWORD: 'test-password',
      PAYMENT_GATEWAY_URL: 'http://localhost:8080',
      INTERNAL_API_KEY: 'test-internal-key-123456',
      RABBITMQ_URL: 'amqp://guest:guest@localhost:5672/',
      DB_POOL_MAX: 5,
      NEXTAUTH_SECRET: 'test-secret-32-chars-long-string',
      NEXTAUTH_URL: 'http://localhost:3000',
      GOOGLE_ID: 'test-google-id',
      GOOGLE_SECRET: 'test-google-secret',
      GITHUB_ID: 'test-github-id',
      GITHUB_SECRET: 'test-github-secret',
    },
  }))
  vi.mock('@/lib/config/provider', async (importOriginal) => {
    const mod = (await importOriginal()) as Record<string, unknown>
    return {
      ...mod,
      getConfig: () => ({
        ENV_TYPE: 'dev',
        NEXT_PUBLIC_ENV_TYPE: 'dev',
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      }),
      isPreview: () => false,
      getEnvType: () => 'dev',
    }
  })
  vi.mock('@/lib/config/preview', async (importOriginal) => {
    const mod = (await importOriginal()) as Record<string, unknown>
    return { ...mod, isPreviewMode: () => false, isPreviewModeClient: () => false }
  })
}
