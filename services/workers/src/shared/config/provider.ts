import { z } from "zod";
import { Logger } from "@shared/logging/Logger";
import { loadFromAWS } from "./aws";

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v !== undefined && v !== "" ? v : fallback;
}

function resolveEnvType(): string {
  const raw = process.env.ENV_TYPE?.toLowerCase().trim();
  if (raw) return raw;
  const legacy = process.env.CONFIG_SOURCE?.toLowerCase().trim();
  if (legacy) {
    Logger.warn("CONFIG_SOURCE is deprecated, use ENV_TYPE=dev|prod", { value: legacy });
    if (legacy === "aws" || legacy === "prod") return "prod";
    if (legacy === "env" || legacy === "dev") return "dev";
    return legacy;
  }
  const nodeEnv = process.env.NODE_ENV?.toLowerCase().trim();
  if (nodeEnv === "production") return "prod";
  if (nodeEnv === "test") return "dev";
  return "dev";
}

function applyDevDefaults(cfg: Record<string, string>): void {
  if (!cfg.RABBITMQ_URL) cfg.RABBITMQ_URL = "amqp://guest:guest@rabbitmq:5672/";
  if (!cfg.AWS_REGION) cfg.AWS_REGION = envOr("AWS_REGION", "ap-south-1");
  if (!cfg.OTEL_SERVICE_NAME) cfg.OTEL_SERVICE_NAME = envOr("OTEL_SERVICE_NAME", "");
}

function loadProdNonSecretOverrides(cfg: Record<string, string>): void {
  for (const key of ["PORT", "OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_NAME", "LOG_LEVEL", "CRON_CHECK_INTERVAL_MS", "CRON_BATCH_SIZE", "REDIS_URL", "DATABASE_URL"]) {
    const v = process.env[key];
    if (v !== undefined && v !== "" && !cfg[key]) cfg[key] = v;
  }
  if (!cfg.AWS_REGION) cfg.AWS_REGION = envOr("AWS_REGION", "ap-south-1");
}

function validateProdStrict(cfg: Record<string, unknown>, schemaHasPaddleKey: boolean): void {
  const rabbit = String((cfg as any).RABBITMQ_URL ?? "");
  if (rabbit.includes("guest:guest@rabbitmq:5672") || rabbit.includes("guest:guest@localhost:5672")) {
    throw new Error("ENV_TYPE=prod must not use default dev RabbitMQ URL");
  }
  if (!rabbit) throw new Error("ENV_TYPE=prod requires RABBITMQ_URL from AWS (detectai/mq/urls) or SSM");
  if (schemaHasPaddleKey && !(cfg as any).PADDLE_API_KEY) {
    throw new Error("ENV_TYPE=prod requires PADDLE_API_KEY from AWS (detectai/workers/secrets)");
  }
}

export async function createConfig<T extends z.ZodTypeAny>(schema: T, workerName: string): Promise<z.infer<T>> {
  const envType = resolveEnvType();
  if (envType !== "dev" && envType !== "prod") {
    throw new Error(`ENV_TYPE must be dev or prod, got "${envType}"`);
  }

  const cfg: Record<string, string> = {};

  if (envType === "dev") {
    try {
      const fs = await import("node:fs");
      const hasEnvFile = fs.existsSync(".env");
      if (hasEnvFile) {
        const dotenv = await import("dotenv");
        dotenv.config();
      } else if (process.env.ENV_FILE) {
        const dotenv = await import("dotenv");
        dotenv.config({ path: process.env.ENV_FILE });
      }
    } catch {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) cfg[k] = v;
    cfg.ENV_TYPE = "dev";
    applyDevDefaults(cfg);
  } else {
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) cfg[k] = v;
    cfg.ENV_TYPE = "prod";
    await loadFromAWS(cfg);
    loadProdNonSecretOverrides(cfg);
  }

  const merged: Record<string, string | undefined> = { ...process.env, ...cfg };
  merged.ENV_TYPE = envType;

  const result = schema.safeParse(merged);
  if (!result.success) {
    Logger.error(`Invalid environment variables for [${workerName}] worker`, { errors: result.error.format() });
    throw new Error(`Invalid environment variables for [${workerName}]: ${result.error.message}`);
  }

  const validated = result.data as Record<string, unknown>;
  if (envType === "prod") {
    const schemaHasPaddle = String((schema as any)?.description ?? "").includes("PADDLE") || "PADDLE_API_KEY" in (validated as any) || (schema as any)?._def?.shape?.PADDLE_API_KEY !== undefined;
    try {
      validateProdStrict(validated, schemaHasPaddle);
    } catch (e) {
      Logger.error(`Prod strict validation failed for [${workerName}]`, e as any);
      throw e;
    }
  }

  Logger.info(`Environment variables loaded for [${workerName}]`, { envType });
  for (const [k, v] of Object.entries(validated)) {
    if (v !== undefined && process.env[k] === undefined) process.env[k] = String(v);
  }
  process.env.ENV_TYPE = envType;
  return result.data as z.infer<T>;
}

export function createConfigSync<T extends z.ZodTypeAny>(schema: T, workerName: string): z.infer<T> {
  const envType = resolveEnvType();
  const merged: Record<string, string | undefined> = { ...process.env, ENV_TYPE: envType };
  const result = schema.safeParse(merged);
  if (!result.success) {
    Logger.error(`Invalid environment variables for [${workerName}] worker`, { errors: result.error.format() });
    throw new Error(`Invalid environment variables for [${workerName}]`);
  }
  return result.data as z.infer<T>;
}
