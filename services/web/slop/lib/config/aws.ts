type AwsConfig = {
  region: string
  endpoint?: string
  credentials?: { accessKeyId: string; secretAccessKey: string }
}

function isFlociEndpoint(ep: string): boolean {
  return ep.includes("localhost:4566") || ep.includes("127.0.0.1:4566") || ep.includes("host.docker.internal:4566")
}

function envOr(key: string, fallback: string): string {
  const v = process.env[key]
  return v !== undefined && v !== "" ? v : fallback
}

function getAwsConfig(): AwsConfig {
  let region = envOr("AWS_REGION", "")
  if (!region) region = "ap-south-1"
  const endpoint = process.env.AWS_ENDPOINT_URL || undefined
  let credentials: AwsConfig["credentials"] | undefined
  if (!process.env.AWS_ACCESS_KEY_ID && endpoint && isFlociEndpoint(endpoint)) {
    credentials = { accessKeyId: "test", secretAccessKey: "test" }
  }
  return { region, endpoint, credentials }
}

function isMissingSecret(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "")
  return msg.includes("ResourceNotFoundException") || msg.includes("not found")
}

function isMissingParam(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "")
  return msg.includes("ParameterNotFound") || msg.includes("not found")
}

const KNOWN_SSM_KEYS = new Set([
  "DATABASE_URL",
  "DATABASE_URL_REPLICA",
  "REDIS_URL",
  "REDIS_PASSWORD",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "GOOGLE_ID",
  "GOOGLE_SECRET",
  "GITHUB_ID",
  "GITHUB_SECRET",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
  "FILE_EXTRACTOR_API_URL",
  "AI_SERVICE_URL",
  "AI_SERVICE_API_KEY",
  "CHAT_SERVICE_URL",
  "PAYMENT_GATEWAY_URL",
  "INTERNAL_API_KEY",
  "RABBITMQ_URL",
  "PROMETHEUS_WEB_SCRAPE_TOKEN",
  "DB_POOL_MAX",
  "LOG_LEVEL",
  "NODE_ENV",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_SERVICE_NAME",
  "AWS_REGION",
])

function applySecretJson(data: Record<string, string>, mapping: Record<string, string>, cfg: Record<string, string>): void {
  for (const [rawKey, val] of Object.entries(data)) {
    if (!val) continue
    const upper = rawKey.toUpperCase()
    const targetFromMapping = mapping[upper]
    if (targetFromMapping) {
      if (!cfg[targetFromMapping]) cfg[targetFromMapping] = String(val)
      continue
    }
    if (KNOWN_SSM_KEYS.has(upper) && !cfg[upper]) {
      cfg[upper] = String(val)
    }
  }
}

async function loadSecretsManager(cfg: Record<string, string>): Promise<void> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager")
  const awsCfg = getAwsConfig()
  const client = new SecretsManagerClient({
    region: awsCfg.region,
    ...(awsCfg.endpoint ? { endpoint: awsCfg.endpoint } : {}),
    ...(awsCfg.credentials ? { credentials: awsCfg.credentials } : {}),
  })

  const secrets: Array<{ secretId: string; mapping: Record<string, string> }> = [
    {
      secretId: envOr("PG_URLS_SECRET_NAME", "detectai/pg/urls"),
      mapping: { DATABASE_URL: "DATABASE_URL", DATABASE_URL_REPLICA: "DATABASE_URL_REPLICA" },
    },
    {
      secretId: envOr("REDIS_USERS_URLS_SECRET_NAME", envOr("REDIS_URLS_SECRET_NAME", "detectai/redis/users/urls")),
      mapping: { REDIS_URL: "REDIS_URL", REDIS_PASSWORD: "REDIS_PASSWORD" },
    },
    {
      secretId: envOr("MQ_URLS_SECRET_NAME", envOr("MQ_SECRETS_NAME", "detectai/mq/urls")),
      mapping: { RABBITMQ_URL: "RABBITMQ_URL", RABBITMQ_ENDPOINT: "RABBITMQ_URL" },
    },
    {
      secretId: envOr("WEB_SECRETS_NAME", envOr("WEB_SECRETS_ARN", "detectai/web/secrets")),
      mapping: {
        NEXTAUTH_SECRET: "NEXTAUTH_SECRET",
        GOOGLE_ID: "GOOGLE_ID",
        GOOGLE_SECRET: "GOOGLE_SECRET",
        GITHUB_ID: "GITHUB_ID",
        GITHUB_SECRET: "GITHUB_SECRET",
        TURNSTILE_SECRET_KEY: "TURNSTILE_SECRET_KEY",
        AI_SERVICE_API_KEY: "AI_SERVICE_API_KEY",
        INTERNAL_API_KEY: "INTERNAL_API_KEY",
        PROMETHEUS_WEB_SCRAPE_TOKEN: "PROMETHEUS_WEB_SCRAPE_TOKEN",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
        NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
      },
    },
  ]

  for (const { secretId, mapping } of secrets) {
    if (!secretId) continue
    try {
      const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }))
      if (!out.SecretString) continue
      const raw = out.SecretString.trim()
      if (!raw) continue
      try {
        const data = JSON.parse(raw) as Record<string, string>
        applySecretJson(data, mapping, cfg)
      } catch {
        const lower = raw.toLowerCase()
        if (lower.startsWith("amqp") || lower.startsWith("postgres") || lower.startsWith("redis")) {
          const firstKey = Object.keys(mapping)[0]
          if (firstKey && !cfg[mapping[firstKey]]) cfg[mapping[firstKey]] = raw
        }
      }
    } catch (err) {
      const hasNeeded = Object.values(mapping).some((k) => cfg[k])
      if (hasNeeded && isMissingSecret(err)) {
        console.warn(`[config] secret not found but cfg already has value, continuing`, { secret: secretId })
        continue
      }
      if (!isMissingSecret(err)) {
        const msg = String((err as Error)?.message ?? err)
        const isCredsError = msg.includes("security token") || msg.includes("credentials") || msg.includes("ECONNREFUSED")
        if (isCredsError && hasNeeded) {
          console.warn(`[config] AWS unreachable but cfg has values, continuing`, { secret: secretId })
          continue
        }
        throw new Error(`get secret ${secretId}: ${msg}`)
      }
      if (process.env.ENV_TYPE === "prod") {
        const isPrimaryWebSecret = secretId === envOr("WEB_SECRETS_NAME", "detectai/web/secrets")
        if (isPrimaryWebSecret || hasNeeded) {
          console.warn(`[config] prod: web secret not found, continuing without it`, { secret: secretId })
        } else {
          throw new Error(`get secret ${secretId}: ${String((err as Error)?.message ?? err)}`)
        }
      }
    }
  }
}

async function loadSSMParameters(cfg: Record<string, string>): Promise<void> {
  let prefix = envOr("SSM_PREFIX", envOr("SSM_PARAM_PREFIX", ""))
  if (!prefix) {
    prefix = "/detectai/web/"
    if (process.env.SSM_ENABLED === "0" || process.env.SSM_ENABLED === "false") return
  }
  if (!prefix.endsWith("/")) prefix += "/"

  const { SSMClient, GetParametersByPathCommand } = await import("@aws-sdk/client-ssm")
  const awsCfg = getAwsConfig()
  const client = new SSMClient({
    region: awsCfg.region,
    ...(awsCfg.endpoint ? { endpoint: awsCfg.endpoint } : {}),
    ...(awsCfg.credentials ? { credentials: awsCfg.credentials } : {}),
  })

  let nextToken: string | undefined
  let found = false
  do {
    try {
      const out = await client.send(
        new GetParametersByPathCommand({
          Path: prefix,
          Recursive: true,
          WithDecryption: true,
          NextToken: nextToken,
        }),
      )
      nextToken = out.NextToken
      for (const p of out.Parameters ?? []) {
        if (!p.Name || !p.Value) continue
        found = true
        const key = p.Name.slice(prefix.length).toUpperCase().replaceAll("-", "_")
        const val = p.Value
        if (process.env[key] !== undefined && process.env[key] !== "") continue
        if (cfg[key] !== undefined && cfg[key] !== "") continue
        if (key === "POOL_MAX" && !cfg.DB_POOL_MAX) {
          cfg.DB_POOL_MAX = val
          continue
        }
        if (KNOWN_SSM_KEYS.has(key) && !cfg[key]) cfg[key] = val
        else if (!KNOWN_SSM_KEYS.has(key) && !cfg[key]) cfg[key] = val
      }
    } catch (err) {
      if (isMissingParam(err)) return
      throw new Error(`ssm get parameters by path ${prefix}: ${String((err as Error)?.message ?? err)}`)
    }
  } while (nextToken)

  if (!found) return
}

export async function loadFromAWS(cfg: Record<string, string>): Promise<void> {
  await loadSecretsManager(cfg)
  await loadSSMParameters(cfg)
}
