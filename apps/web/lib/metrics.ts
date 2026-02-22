import { Registry, collectDefaultMetrics, Histogram, Counter, Metric } from "prom-client"

const globalForMetrics = global as unknown as { registry: Registry }

export const registry = globalForMetrics.registry || new Registry()

if (!globalForMetrics.registry) {
  collectDefaultMetrics({ register: registry })
  globalForMetrics.registry = registry
}

function getOrCreateMetric<T extends Metric>(name: string, factory: () => T): T {
  const existing = registry.getSingleMetric(name)
  if (existing) {
    return existing as T
  }
  return factory()
}

export const metrics = {
  httpRequestDuration: getOrCreateMetric('http_request_duration_seconds', () => new Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 10],
    registers: [registry],
  })),

  dbQueryDuration: getOrCreateMetric('db_query_duration_seconds', () => new Histogram({
    name: "db_query_duration_seconds",
    help: "Duration of database queries in seconds",
    labelNames: ["model", "operation", "status"],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
    registers: [registry],
  })),

  cacheOperations: getOrCreateMetric('cache_operations_total', () => new Counter({
    name: "cache_operations_total",
    help: "Total number of cache operations",
    labelNames: ["operation", "status"],
    registers: [registry],
  })),

  aiInferenceDuration: getOrCreateMetric('ai_inference_duration_seconds', () => new Histogram({
    name: "ai_inference_duration_seconds",
    help: "Duration of AI model inference",
    labelNames: ["model", "status"],
    buckets: [0.5, 1, 2, 5, 10, 20],
    registers: [registry],
  })),

  rateLimitHits: getOrCreateMetric('rate_limit_hits_total', () => new Counter({
    name: "rate_limit_hits_total",
    help: "Total number of rate limit hits",
    labelNames: ["tier"],
    registers: [registry],
  })),
}