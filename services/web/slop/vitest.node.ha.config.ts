import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * HA config: real 3-node RabbitMQ via testcontainers (no Compose).
 * Deliberately does NOT load test/setup-node.ts — those global mocks
 * (redis/prisma/env/metrics) would stub out the broker under test.
 * Only *.ha.test.ts files run here; unit + integration-backend stay on
 * their existing configs/jobs untouched.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/infrastructure/__tests__/ha/**/*.ha.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    coverage: {
      provider: 'v8',
      enabled: false,
    },
  },
})
