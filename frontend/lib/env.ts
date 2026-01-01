import "server-only"
import { z } from "zod"

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  NEXTAUTH_URL: z.string().url().optional(),
  
  // Third Party Secrets
  GOOGLE_ID: z.string().optional(),
  GOOGLE_SECRET: z.string().optional(),
  GITHUB_ID: z.string().optional(),
  GITHUB_SECRET: z.string().optional(),

  // Security & Captcha
  TURNSTILE_SECRET_KEY: z.string().min(1, "TURNSTILE_SECRET_KEY is required"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1, "Turnstile Site Key is required"),
  
  // Redis
  REDIS_URL: z.string().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
})

export const env = envSchema.parse(process.env)