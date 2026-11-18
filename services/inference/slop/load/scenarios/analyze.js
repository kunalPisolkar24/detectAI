import { readDuration, readPositiveInt, readRatio } from "../lib/config.js";
import { createAnalyzeMetrics, runAnalyzeDocumentIteration } from "../lib/analyze.js";

const analyzeMetrics = createAnalyzeMetrics("inference_load_analyze");

const p95ThresholdMs = readPositiveInt("INFERENCE_LOAD_ANALYZE_P95_MS", 5000);
const p99ThresholdMs = readPositiveInt("INFERENCE_LOAD_ANALYZE_P99_MS", 10000);
const firstEventP95ThresholdMs = readPositiveInt("INFERENCE_LOAD_ANALYZE_FIRST_EVENT_P95_MS", 1500);
const minSuccessRate = readRatio("INFERENCE_LOAD_ANALYZE_MIN_SUCCESS_RATE", 0.99);

export const options = {
  scenarios: {
    analyze: {
      executor: "constant-vus",
      exec: "analyzeScenario",
      vus: readPositiveInt("INFERENCE_LOAD_ANALYZE_VUS", 6),
      duration: readDuration("INFERENCE_LOAD_ANALYZE_DURATION", "5m"),
      gracefulStop: readDuration("INFERENCE_LOAD_ANALYZE_GRACEFUL_STOP", "30s"),
      tags: {
        service: "inference",
        test_type: "load",
        rpc: "AnalyzeDocument",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    inference_load_analyze_success_rate: [`rate>=${minSuccessRate}`],
    inference_load_analyze_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
    inference_load_analyze_time_to_first_event: [`p(95)<${firstEventP95ThresholdMs}`],
  },
};

export async function analyzeScenario() {
  await runAnalyzeDocumentIteration({
    scenario: "analyze",
    metrics: analyzeMetrics,
  });
}
