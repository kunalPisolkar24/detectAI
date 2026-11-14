// Load knobs: each reader names its env keys and default; empty values count as
// unset, since compose interpolates ${VAR:-} into empty entries rather than dropping them.

const DURATION_UNITS_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

// The first non-empty setting across the given env names, as { name, raw }.
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

export function readStages(names, fallback) {
  const setting = firstSetting(names);
  const raw = setting ? setting.raw : fallback;
  if (!raw) {
    throw new Error(`${[].concat(names)[0]} must include at least one stage`);
  }
  return raw.split(",").map((entry) => {
    const [duration, targetValue] = entry.split(":").map((value) => value.trim());
    const target = Number.parseInt(targetValue, 10);
    if (!duration || !Number.isInteger(target) || target < 0) {
      throw new Error(`${(setting || { name: [].concat(names)[0] }).name} must use duration:target entries`);
    }
    return { duration, target };
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

// The workload shares: read, write, and lifecycle. They are normalized at load
// time, so the file may carry any relative weights.
const DEFAULT_MIX = { read: 0.5, write: 0.3, lifecycle: 0.2 };

function normalizeMix(mix) {
  const total = mix.read + mix.write + mix.lifecycle;
  if (!(total > 0)) {
    throw new Error("the CHATS_LOAD_MIX_* weights must add up to more than zero");
  }
  return {
    read: mix.read / total,
    write: mix.write / total,
    lifecycle: mix.lifecycle / total,
  };
}

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    const requestTimeout = readDuration("CHATS_LOAD_REQUEST_TIMEOUT", "10s");
    const apiKey = (__ENV.API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("API_KEY must name the key the target booted with");
    }
    cachedRuntimeConfig = {
      baseUrl: (__ENV.API_URL || "http://chats:8090").replace(/\/$/, ""),
      apiKey,
      // The burst budgets are counted per owner per minute, so the owner pool
      // is what keeps the run off the limiter.
      owners: readPositiveInt("CHATS_LOAD_OWNERS", 4096),
      mix: normalizeMix({
        read: readRatio("CHATS_LOAD_MIX_READ", DEFAULT_MIX.read),
        write: readRatio("CHATS_LOAD_MIX_WRITE", DEFAULT_MIX.write),
        lifecycle: readRatio("CHATS_LOAD_MIX_LIFECYCLE", DEFAULT_MIX.lifecycle),
      }),
      deleteRate: readRatio("CHATS_LOAD_DELETE_RATE", 1),
      // The target's create budget: the smoke exhausts it on purpose.
      createLimit: readPositiveInt("CHATS_LOAD_CREATE_LIMIT", 10),
      contentBytes: readPositiveInt("CHATS_LOAD_CONTENT_BYTES", 1024),
      requestTimeout,
      requestTimeoutMs: parseDurationMs(requestTimeout, "CHATS_LOAD_REQUEST_TIMEOUT"),
    };
  }
  return cachedRuntimeConfig;
}
