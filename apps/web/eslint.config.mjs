import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "lib/infrastructure/grpc-client.ts",
      "lib/shared/grpc/chat-client.ts",
      "lib/infrastructure/service-health.ts",
      "lib/infrastructure/analytics-publisher.ts",
      "features/chat/services/grpc-chat-service.ts",
      "features/chat/services/inference-service.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "**/__tests__/**",
    "**/test/**",
    "**/tests/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.k6.js",
    "coverage/**",
  ]),
]);

export default eslintConfig;
