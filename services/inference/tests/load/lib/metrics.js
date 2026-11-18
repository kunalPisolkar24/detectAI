import { Counter, Rate, Trend } from "k6/metrics";

export function createStreamMetrics(prefix) {
  return {
    duration: new Trend(`${prefix}_duration`, true),
    timeToFirstEvent: new Trend(`${prefix}_time_to_first_event`, true),
    eventCount: new Trend(`${prefix}_event_count`),
    chunkCount: new Trend(`${prefix}_chunk_count`),
    successRate: new Rate(`${prefix}_success_rate`),
    failures: new Counter(`${prefix}_failures`),
    backpressure: new Counter(`${prefix}_backpressure_total`),
  };
}

export function createUnaryMetrics(prefix) {
  return {
    duration: new Trend(`${prefix}_duration`, true),
    successRate: new Rate(`${prefix}_success_rate`),
    failures: new Counter(`${prefix}_failures`),
    backpressure: new Counter(`${prefix}_backpressure_total`),
  };
}
