import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      'server-only': 'test/mocks/empty.ts',
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup-node.ts'],
    globals: true,
    include: ['features/**/__tests__/integration-backend/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['features/**/*.{ts,tsx}'],
      exclude: [
        'features/**/__tests__/**/*.{ts,tsx}',
        'features/**/*.d.ts',
        'features/**/types.ts',
        'features/**/constants.ts',
      ],
    },
  },
})
