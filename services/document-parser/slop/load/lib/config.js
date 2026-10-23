const DURATION_UNITS_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

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

export function readDuration(name, fallback) {
  const raw = (__ENV[name] || fallback || "").trim();
  if (!raw) {
    throw new Error(`${name} must be a duration`);
  }
  return raw;
}

export function readList(name, fallback) {
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

const DEFAULT_PROFILES = ["txt-small", "txt-medium", "txt-large", "pdf-small", "docx-small"];

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  if (!cachedRuntimeConfig) {
    const requestTimeout = readDuration("DOCPARSER_LOAD_REQUEST_TIMEOUT", "35s");
    cachedRuntimeConfig = {
      baseUrl: (__ENV.API_URL || "http://document-parser:8000").replace(/\/$/, ""),
      profiles: readList("DOCPARSER_LOAD_PROFILES", DEFAULT_PROFILES),
      requestTimeout,
      requestTimeoutMs: parseDurationMs(requestTimeout, "DOCPARSER_LOAD_REQUEST_TIMEOUT"),
    };
  }
  return cachedRuntimeConfig;
}

export function resetRuntimeConfigForTests() {
  cachedRuntimeConfig = undefined;
}
