import { vi } from 'vitest'

export const setupEnvMocks = () => {
  vi.mock('@/lib/config/env', () => ({
    env: {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key',
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test-paddle-token',
      TURNSTILE_SECRET_KEY: 'test-secret-key',
      FILE_EXTRACTOR_API_URL: 'http://localhost:8000',
      INFERENCE_SERVICE_URL: 'localhost:50051',
      REDIS_MODE: 'standalone',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_PASSWORD: 'test-password',
      PAYMENT_GATEWAY_URL: 'http://localhost:8080',
    },
  }))
}
