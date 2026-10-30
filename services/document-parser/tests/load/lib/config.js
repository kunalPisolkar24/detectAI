// Environment knobs with a single resolution step: each reader names its
// env key and its built-in default — a scenario runs with no configuration
// at all while .env.load retunes it. The file is the only override path;
// empty values count as unset: compose interpolates ${VAR:-} into empty
// entries rather than dropping them.

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

// The default mix: both small non-text formats plus the text spread over the
// tiers (short serves, mid sustains load, long stresses the cap and output
// limit). Oversize rows stay opt-in — they answer 413 at the default limits.
const DEFAULT_PROFILES = ["short.txt", "mid.txt", "long.txt", "short.pdf", "short.docx"];

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    const requestTimeout = readDuration("DOCPARSER_LOAD_REQUEST_TIMEOUT", "35s");
    cachedRuntimeConfig = {
      baseUrl: (__ENV.API_URL || "http://document-parser:8000").replace(/\/$/, ""),
      // The shared key as x-api-key; empty means the header is not sent and
      // every guarded route answers 401 (the harness fails loud).
      apiKey: (__ENV.API_KEY || "").trim(),
      profiles: readList("DOCPARSER_LOAD_PROFILES", DEFAULT_PROFILES),
      requestTimeout,
      requestTimeoutMs: parseDurationMs(requestTimeout, "DOCPARSER_LOAD_REQUEST_TIMEOUT"),
    };
  }
  return cachedRuntimeConfig;
}
