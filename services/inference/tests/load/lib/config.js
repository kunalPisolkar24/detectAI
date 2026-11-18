// Everything is configured by infra/.env.load, injected into both containers.
// Each reader names its key and a built-in default so a script also runs bare.

const DURATION_UNITS_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

function firstSetting(names) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = (__ENV[name] || "").trim();
    if (raw) {
      return { name, raw };
    }
  }
  return undefined;
}

export function readPositiveInt(names, fallback) {
  const setting = firstSetting(names);
  if (!setting) {
    return fallback;
  }
  const value = Number.parseInt(setting.raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${setting.name} must be a positive integer`);
  }
  return value;
}

export function readRatio(names, fallback) {
  const setting = firstSetting(names);
  if (!setting) {
    return fallback;
  }
  const value = Number.parseFloat(setting.raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${setting.name} must be between 0 and 1`);
  }
  return value;
}

export function readDuration(names, fallback) {
  const raw = (firstSetting(names) || { raw: fallback || "" }).raw.trim();
  if (!raw) {
    throw new Error(`${[].concat(names)[0]} must be a duration`);
  }
  return raw;
}

export function readList(names, fallback) {
  const setting = firstSetting(names);
  if (!setting) {
    return [...fallback];
  }
  const values = setting.raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) {
    throw new Error(`${setting.name} must include at least one value`);
  }
  return values;
}

export function readStages(names, fallback) {
  const setting = firstSetting(names);
  const raw = setting ? setting.raw : fallback;
  if (!raw) {
    throw new Error(`${[].concat(names)[0]} must include at least one stage`);
  }
  return raw.split(",").map((entry) => {
    const [duration, target] = entry.split(":").map((value) => value.trim());
    const rate = Number.parseInt(target, 10);
    if (!duration || !Number.isInteger(rate) || rate < 0) {
      throw new Error(`${(setting || { name: [].concat(names)[0] }).name} must use duration:target entries`);
    }
    return { duration, target: rate };
  });
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

const DEFAULT_PROFILES = ["short", "medium", "long", "xl"];

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    const connectTimeout = readDuration("INFERENCE_LOAD_CONNECT_TIMEOUT", "10s");
    const rpcTimeout = readDuration("INFERENCE_LOAD_RPC_TIMEOUT", "120s");
    const apiKey = (__ENV.API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("API_KEY is required (it is the service's x-api-key too)");
    }
    cachedRuntimeConfig = {
      grpcAddr: (__ENV.GRPC_ADDR || "inference:50051").trim(),
      protoDir: (__ENV.INFERENCE_LOAD_PROTO_DIR || "../../api/proto").trim(),
      apiKey,
      models: readList("ENABLED_MODELS", ["spark"]),
      profiles: readList("INFERENCE_LOAD_PROFILES", DEFAULT_PROFILES),
      connectTimeout,
      rpcTimeout,
      rpcTimeoutMs: parseDurationMs(rpcTimeout, "INFERENCE_LOAD_RPC_TIMEOUT"),
    };
  }
  return cachedRuntimeConfig;
}
