import '@testing-library/jest-dom'
import './prisma-mock'
import { vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key',
    NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'test-paddle-token',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
    FILE_EXTRACTOR_API_URL: 'http://localhost:8000',
    INFERENCE_SERVICE_URL: 'localhost:50051',
  }
}))
