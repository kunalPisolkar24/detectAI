const isProd = process.env.NEXT_PUBLIC_ENV_TYPE === "prod"

export function getAuthSecret(): string | undefined {
  return process.env.AUTH_SECRET ?? (isProd ? undefined : "dev-auth-secret-not-for-production-32chars")
}
