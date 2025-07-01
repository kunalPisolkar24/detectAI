import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
    ],
    coverage: {
      provider: 'v8',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/index.ts',
        '**/index.js',
        'vitest.setup.ts',
        '**/*.d.ts',
        '**/page.tsx',
        '**/*.mjs',
        'eslint.config.js',
        'middleware.ts',
        'tailwind.config.ts',
        '**/layout.tsx',
        'config/**',
        'lib/**'
      ],
    },
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@workspace/ui': path.resolve(__dirname, '../../packages/ui/src')
    },
  },
});