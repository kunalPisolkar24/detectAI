import { Counter, Rate, Trend } from "k6/metrics";

export function createExtractMetrics(prefix) {
  return {
    duration: new Trend(`${prefix}_duration`, true),
    successRate: new Rate(`${prefix}_success_rate`),
    failures: new Counter(`${prefix}_failures`),
    timeouts: new Counter(`${prefix}_timeouts`),
  };
}

export function createNegativeMetrics(prefix) {
  return {
    successRate: new Rate(`${prefix}_success_rate`),
    failures: new Counter(`${prefix}_failures`),
  };
}

export function createReadinessMetrics(prefix) {
  return {
    notReady: new Counter(`${prefix}_not_ready_total`),
    checks: new Counter(`${prefix}_checks_total`),
  };
}
