// Load knobs: each reader names its env keys and default; empty values count as
// unset, since compose interpolates ${VAR:-} into empty entries rather than dropping them.

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

// The default mix stretches from the envelope floor to the read bound's room.
const DEFAULT_PROFILES = ["small", "mid", "large", "near-limit"];

const DEFAULT_EVENT_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
  "transaction.completed",
];

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    const requestTimeout = readDuration("WEBHOOK_LOAD_REQUEST_TIMEOUT", "10s");
    const webhookSecret = (__ENV.PADDLE_WEBHOOK_SECRET || "").trim();
    if (!webhookSecret) {
      throw new Error("PADDLE_WEBHOOK_SECRET must name the secret the target booted with");
    }
    cachedRuntimeConfig = {
      baseUrl: (__ENV.API_URL || "http://payment-webhook:8080").replace(/\/$/, ""),
      webhookSecret,
      profiles: readList("WEBHOOK_LOAD_PROFILES", DEFAULT_PROFILES),
      eventTypes: readList("WEBHOOK_LOAD_EVENT_TYPES", DEFAULT_EVENT_TYPES),
      // Rotating identities so FIFO groups spread instead of serializing onto one.
      pool: readPositiveInt("WEBHOOK_LOAD_POOL", 64),
      requestTimeout,
      requestTimeoutMs: parseDurationMs(requestTimeout, "WEBHOOK_LOAD_REQUEST_TIMEOUT"),
    };
  }
  return cachedRuntimeConfig;
}
