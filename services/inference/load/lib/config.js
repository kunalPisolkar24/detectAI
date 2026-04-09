const DEFAULT_TEXT_PROFILES = ["short", "medium", "large"];
const DEFAULT_MODELS = ["spark", "flare"];

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

function readPositiveInt(name, fallback) {
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

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    cachedRuntimeConfig = {
      target: readRequired("INFERENCE_LOAD_GRPC_TARGET"),
      authToken: readRequired("INFERENCE_LOAD_AUTH_TOKEN"),
      plaintext: readBoolean("INFERENCE_LOAD_GRPC_PLAINTEXT", true),
      connectTimeout: (__ENV.INFERENCE_LOAD_CONNECT_TIMEOUT || "5s").trim(),
      rpcTimeout: (__ENV.INFERENCE_LOAD_RPC_TIMEOUT || "30s").trim(),
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
