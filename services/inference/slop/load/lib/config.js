const DEFAULT_TEXT_PROFILES = ["short", "medium", "large"];
const DEFAULT_MODELS = ["spark", "flare"];
const DURATION_UNITS_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

function readRequired(name) {
  const value = __ENV[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function readList(name, fallback) {
  const raw = (__ENV[name] || "").trim();
  if (!raw) {
    return [...fallback];
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!values.length) {
    throw new Error(`${name} must include at least one value`);
  }

  return values;
}

function readBoolean(name, fallback) {
  const raw = (__ENV[name] || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

export function readDuration(name, fallback) {
  const raw = (__ENV[name] || fallback || "").trim();
  if (!raw) {
    throw new Error(`${name} must be a duration`);
  }

  return raw;
}

export function readPositiveInt(name, fallback) {
  const raw = (__ENV[name] || "").trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function readRatio(name, fallback) {
  const raw = (__ENV[name] || "").trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }

  return value;
}

export function parseDurationMs(value, name = "duration") {
  const raw = `${value || ""}`.trim();
  if (!raw) {
    throw new Error(`${name} must be a duration`);
  }

  const matcher = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let totalMs = 0;
  let lastIndex = 0;
  let match;

  while ((match = matcher.exec(raw)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`${name} must be a valid duration`);
    }

    totalMs += Number.parseFloat(match[1]) * DURATION_UNITS_MS[match[2]];
    lastIndex = matcher.lastIndex;
  }

  if (lastIndex !== raw.length || totalMs <= 0) {
    throw new Error(`${name} must be a valid duration`);
  }

  return Math.round(totalMs);
}

export function readStages(name, fallback) {
  const raw = (__ENV[name] || fallback).trim();
  if (!raw) {
    throw new Error(`${name} must include at least one stage`);
  }

  return raw.split(",").map((entry) => {
    const [duration, targetValue] = entry.split(":").map((value) => value.trim());
    const target = Number.parseInt(targetValue, 10);

    if (!duration || !Number.isInteger(target) || target < 0) {
      throw new Error(`${name} must use duration:target entries`);
    }

    return {
      duration,
      target,
    };
  });
}

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    const connectTimeout = readDuration("INFERENCE_LOAD_CONNECT_TIMEOUT", "5s");
    const rpcTimeout = readDuration("INFERENCE_LOAD_RPC_TIMEOUT", "30s");

    cachedRuntimeConfig = {
      target: readRequired("INFERENCE_LOAD_GRPC_TARGET"),
      authToken: readRequired("INFERENCE_LOAD_AUTH_TOKEN"),
      plaintext: readBoolean("INFERENCE_LOAD_GRPC_PLAINTEXT", true),
      connectTimeout,
      rpcTimeout,
      rpcTimeoutMs: parseDurationMs(rpcTimeout, "INFERENCE_LOAD_RPC_TIMEOUT"),
      models: readList("INFERENCE_LOAD_MODELS", DEFAULT_MODELS),
      textProfiles: readList("INFERENCE_LOAD_TEXT_PROFILES", DEFAULT_TEXT_PROFILES),
    };
  }

  return cachedRuntimeConfig;
}

export function buildSmokeOptions() {
  return {
    vus: readPositiveInt("INFERENCE_LOAD_SMOKE_VUS", 1),
    iterations: readPositiveInt("INFERENCE_LOAD_SMOKE_ITERATIONS", 1),
    thresholds: {
      checks: ["rate==1"],
    },
    tags: {
      service: "inference",
      test_type: "smoke",
    },
  };
}
