import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `prisma migrate deploy` uses direct URL; pooled PgBouncer URLs should set DIRECT_URL
    // Fallback to DATABASE_URL if DIRECT_URL not set.
    seed: undefined,
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
