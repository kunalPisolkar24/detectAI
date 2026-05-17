import { readDuration, readPositiveInt, readRatio } from "../lib/config.js";
import { createAnalyzeMetrics, runAnalyzeDocumentIteration } from "../lib/analyze.js";

const soakMetrics = createAnalyzeMetrics("inference_load_analyze_soak");

const p95ThresholdMs = readPositiveInt("INFERENCE_LOAD_SOAK_P95_MS", 7000);
const p99ThresholdMs = readPositiveInt("INFERENCE_LOAD_SOAK_P99_MS", 12000);
const firstEventP95ThresholdMs = readPositiveInt("INFERENCE_LOAD_SOAK_FIRST_EVENT_P95_MS", 2000);
const minSuccessRate = readRatio("INFERENCE_LOAD_SOAK_MIN_SUCCESS_RATE", 0.99);

export const options = {
  scenarios: {
    soak: {
      executor: "constant-vus",
      exec: "soakScenario",
      vus: readPositiveInt("INFERENCE_LOAD_SOAK_VUS", 2),
      duration: readDuration("INFERENCE_LOAD_SOAK_DURATION", "30m"),
      gracefulStop: readDuration("INFERENCE_LOAD_SOAK_GRACEFUL_STOP", "1m"),
      tags: {
        service: "inference",
        test_type: "soak",
        rpc: "AnalyzeDocument",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    inference_load_analyze_soak_success_rate: [`rate>=${minSuccessRate}`],
    inference_load_analyze_soak_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
    inference_load_analyze_soak_time_to_first_event: [`p(95)<${firstEventP95ThresholdMs}`],
  },
};

export async function soakScenario() {
  await runAnalyzeDocumentIteration({
    scenario: "soak",
    metrics: soakMetrics,
  });
}
