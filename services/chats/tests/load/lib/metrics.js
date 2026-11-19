import { Counter, Rate, Trend } from "k6/metrics";

// One metric set per scenario prefix: the aggregate trend carries the
// threshold, the per-procedure trends say which call moved it.
export function createRpcMetrics(prefix) {
  return {
    duration: new Trend(`${prefix}_duration`, true),
    successRate: new Rate(`${prefix}_success_rate`),
    failures: new Counter(`${prefix}_failures`),
    timeouts: new Counter(`${prefix}_timeouts`),
    rateLimited: new Counter(`${prefix}_rate_limited`),
    op: {
      create: new Trend(`${prefix}_create_duration`, true),
      save: new Trend(`${prefix}_save_duration`, true),
      get: new Trend(`${prefix}_get_duration`, true),
      history: new Trend(`${prefix}_history_duration`, true),
      list: new Trend(`${prefix}_list_duration`, true),
      rename: new Trend(`${prefix}_rename_duration`, true),
      delete: new Trend(`${prefix}_delete_duration`, true),
    },
  };
}

export function createReadinessMetrics(prefix) {
  return {
    notReady: new Counter(`${prefix}_not_ready_total`),
    checks: new Counter(`${prefix}_checks_total`),
  };
}

// The expected-failure rows score on their own set: a refused call is the
// row's success, not a failure of the run.
export function createExpectationMetrics(prefix) {
  return {
    successRate: new Rate(`${prefix}_expectation_rate`),
    failures: new Counter(`${prefix}_expectation_failures`),
  };
}
