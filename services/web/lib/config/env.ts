import { parseServerEnv, type RawServerEnv } from "./schema"

const raw: RawServerEnv = {
  envType: process.env.NEXT_PUBLIC_ENV_TYPE,
  authSecret: process.env.AUTH_SECRET,
  authUrl: process.env.AUTH_URL,
  githubId: process.env.AUTH_GITHUB_ID,
  githubSecret: process.env.AUTH_GITHUB_SECRET,
  googleId: process.env.AUTH_GOOGLE_ID,
  googleSecret: process.env.AUTH_GOOGLE_SECRET,
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY,
  usersServiceUrl: process.env.USERS_SERVICE_URL,
  usersServiceApiKey: process.env.USERS_SERVICE_API_KEY,
}

const parsed = parseServerEnv(raw, process.env.VERCEL_ENV)

export const env = {
  envType: parsed.envType,
  auth: {
    secret: parsed.authSecret,
    url: parsed.authUrl,
    github: { id: parsed.githubId, secret: parsed.githubSecret },
    google: { id: parsed.googleId, secret: parsed.googleSecret },
  },
  turnstile: {
    secretKey: parsed.turnstileSecretKey,
  },
  users: {
    url: parsed.usersServiceUrl,
    apiKey: parsed.usersServiceApiKey,
  },
}

export const isProd = parsed.envType === "prod"
export const isDev = parsed.envType === "dev"
export const isPreview = parsed.envType === "preview"
