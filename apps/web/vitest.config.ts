import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    // HA suites need a real 3-node broker (test:integration:ha); never run them in unit jobs.
    exclude: ['node_modules/**', 'e2e/**', '.next/**', '**/*.ha.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['features/**/*.{ts,tsx}'],
      exclude: [
        'features/**/__tests__/**/*.{ts,tsx}',
        'features/**/*.d.ts',
        'features/**/types.ts',
        'features/**/constants.ts',
      ],
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})

