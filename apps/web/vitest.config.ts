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
    alias: {
      // Update this path to resolve to the root of 'apps/web'
      '@': path.resolve(__dirname, '.'),
      // Add the alias for your shared UI package to match tsconfig.json
      // Make sure the relative path from 'apps/web' to 'packages/ui/src' is correct
      '@workspace/ui': path.resolve(__dirname, '../../packages/ui/src')
    },
  },
});