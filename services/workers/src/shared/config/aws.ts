import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { Logger } from "@shared/logging/Logger";

type AwsConfig = {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

function isFlociEndpoint(ep: string): boolean {
  return ep.includes("localhost:4566") || ep.includes("127.0.0.1:4566") || ep.includes("host.docker.internal:4566");
}

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v !== undefined && v !== "" ? v : fallback;
}

function getAwsConfig(): AwsConfig {
  let region = envOr("AWS_REGION", "");
  if (!region) region = "ap-south-1";
  const endpoint = process.env.AWS_ENDPOINT_URL || undefined;
  let credentials: AwsConfig["credentials"] | undefined;
  if (!process.env.AWS_ACCESS_KEY_ID && endpoint && isFlociEndpoint(endpoint)) {
    credentials = { accessKeyId: "test", secretAccessKey: "test" };
  }
  return { region, endpoint, credentials };
}

function isMissingSecret(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return msg.includes("ResourceNotFoundException") || msg.includes("not found");
}

function isMissingParam(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return msg.includes("ParameterNotFound") || msg.includes("not found");
}

async function loadSecretsManager(cfg: Record<string, string>): Promise<void> {
  const awsCfg = getAwsConfig();
  const client = new SecretsManagerClient({
    region: awsCfg.region,
    ...(awsCfg.endpoint ? { endpoint: awsCfg.endpoint } : {}),
    ...(awsCfg.credentials ? { credentials: awsCfg.credentials } : {}),
  });

  const mqSecret = envOr("MQ_SECRETS_NAME", envOr("MQ_URLS_SECRET_NAME", "detectai/mq/urls"));
  if (mqSecret) {
    try {
      const out = await client.send(new GetSecretValueCommand({ SecretId: mqSecret }));
      if (out.SecretString) {
        const raw = out.SecretString.trim();
        try {
          const data = JSON.parse(raw) as Record<string, string>;
          if (data.RABBITMQ_URL && !cfg.RABBITMQ_URL) cfg.RABBITMQ_URL = data.RABBITMQ_URL;
        } catch {
          if (raw.startsWith("amqp") && !cfg.RABBITMQ_URL) cfg.RABBITMQ_URL = raw;
        }
      }
    } catch (err) {
      if (!isMissingSecret(err)) throw new Error(`get secret ${mqSecret}: ${String((err as any)?.message ?? err)}`);
      if (process.env.ENV_TYPE === "prod") throw new Error(`get secret ${mqSecret}: ${String((err as any)?.message ?? err)}`);
    }
  }

  const workersSecret = envOr("WORKERS_SECRETS_NAME", envOr("WORKERS_SECRETS_ARN", "detectai/workers/secrets"));
  if (workersSecret) {
    try {
      const out = await client.send(new GetSecretValueCommand({ SecretId: workersSecret }));
      if (out.SecretString) {
        try {
          const data = JSON.parse(out.SecretString) as Record<string, string>;
          for (const [k, v] of Object.entries(data)) {
            if (!v) continue;
            const upper = k.toUpperCase();
            if (upper === "PADDLE_API_KEY" && !cfg.PADDLE_API_KEY) cfg.PADDLE_API_KEY = v;
            else if (upper === "PADDLE_ENVIRONMENT" && !cfg.PADDLE_ENVIRONMENT) cfg.PADDLE_ENVIRONMENT = v;
            else if (upper === "RABBITMQ_URL" && !cfg.RABBITMQ_URL) cfg.RABBITMQ_URL = v;
            else if (!cfg[upper]) cfg[upper] = v;
          }
        } catch {}
      }
    } catch (err) {
      if (!isMissingSecret(err)) throw new Error(`get secret ${workersSecret}: ${String((err as any)?.message ?? err)}`);
      if (process.env.ENV_TYPE === "prod") Logger.warn(`Workers secret not found, continuing without it`, { secret: workersSecret });
    }
  }
}

async function loadSSMParameters(cfg: Record<string, string>): Promise<void> {
  let prefix = envOr("SSM_PREFIX", envOr("SSM_PARAM_PREFIX", ""));
  if (!prefix) {
    prefix = "/detectai/workers/";
    if (process.env.SSM_ENABLED === "0" || process.env.SSM_ENABLED === "false") return;
  }
  if (!prefix.endsWith("/")) prefix += "/";

  const awsCfg = getAwsConfig();
  const client = new SSMClient({
    region: awsCfg.region,
    ...(awsCfg.endpoint ? { endpoint: awsCfg.endpoint } : {}),
    ...(awsCfg.credentials ? { credentials: awsCfg.credentials } : {}),
  });

  let nextToken: string | undefined;
  let found = false;
  do {
    try {
      const out = await client.send(
        new GetParametersByPathCommand({
          Path: prefix,
          Recursive: true,
          WithDecryption: true,
          NextToken: nextToken,
        }),
      );
      nextToken = out.NextToken;
      for (const p of out.Parameters ?? []) {
        if (!p.Name || !p.Value) continue;
        found = true;
        const key = p.Name.slice(prefix.length).toUpperCase().replaceAll("-", "_");
        const val = p.Value;
        if (process.env[key] !== undefined && process.env[key] !== "") continue;
        if (cfg[key] !== undefined && cfg[key] !== "") continue;
        switch (key) {
          case "RABBITMQ_URL":
            if (!cfg.RABBITMQ_URL) cfg.RABBITMQ_URL = val;
            break;
          case "PORT":
          case "OTEL_EXPORTER_OTLP_ENDPOINT":
          case "OTEL_SERVICE_NAME":
          case "LOG_LEVEL":
          case "CRON_CHECK_INTERVAL_MS":
          case "CRON_BATCH_SIZE":
          case "REDIS_URL":
          case "DATABASE_URL":
          case "EVENT_REDIS_URL":
            if (!cfg[key]) cfg[key] = val;
            break;
          default:
            if (!cfg[key]) cfg[key] = val;
        }
      }
    } catch (err) {
      if (isMissingParam(err)) return;
      throw new Error(`ssm get parameters by path ${prefix}: ${String((err as any)?.message ?? err)}`);
    }
  } while (nextToken);

  if (!found) return;
}

export async function loadFromAWS(cfg: Record<string, string>): Promise<void> {
  await loadSecretsManager(cfg);
  await loadSSMParameters(cfg);
}
