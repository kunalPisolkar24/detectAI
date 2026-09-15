import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // `prisma migrate deploy` must use the direct writer URL, never a pooled
    // PgBouncer / RDS Proxy URL. If a pooled DATABASE_URL is in use, set
    // DIRECT_URL to the writer endpoint and keep DATABASE_URL for the app pools.
    seed: undefined,
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
