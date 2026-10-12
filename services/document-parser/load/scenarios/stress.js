import exec from "k6/execution";

import { getRuntimeConfig, readDuration, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { pickFixture } from "../lib/files.js";
import { createExtractMetrics, createReadinessMetrics } from "../lib/metrics.js";
import { checkReadiness, postExtract } from "../lib/requests.js";

const metrics = createExtractMetrics("docparser_stress");
const readiness = createReadinessMetrics("docparser_stress_readiness");

const p95ThresholdMs = readPositiveInt("DOCPARSER_LOAD_STRESS_P95_MS", 3000);
const p99ThresholdMs = readPositiveInt("DOCPARSER_LOAD_STRESS_P99_MS", 6000);
const minSuccessRate = readRatio("DOCPARSER_LOAD_STRESS_MIN_SUCCESS_RATE", 0.95);

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      exec: "spikeScenario",
      startRate: readPositiveInt("DOCPARSER_LOAD_STRESS_START_RATE", 1),
      timeUnit: "1s",
      preAllocatedVUs: readPositiveInt("DOCPARSER_LOAD_STRESS_PREALLOCATED_VUS", 20),
      maxVUs: readPositiveInt("DOCPARSER_LOAD_STRESS_MAX_VUS", 100),
      stages: readStages("DOCPARSER_LOAD_STRESS_STAGES", "10s:5,30s:10,10s:0"),
      gracefulStop: readDuration("DOCPARSER_LOAD_STRESS_GRACEFUL_STOP", "30s"),
      tags: {
        service: "document-parser",
        test_type: "stress",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    docparser_stress_success_rate: [`rate>=${minSuccessRate}`],
    docparser_stress_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  },
};

export function spikeScenario() {
  const config = getRuntimeConfig();
  const fixture = pickFixture(config.profiles);
  postExtract({
    baseUrl: config.baseUrl,
    fixture,
    timeout: config.requestTimeout,
    metrics,
    scenario: "stress",
  });

  // Sample backpressure every 10th arrival without doubling request volume.
  if (exec.scenario.iterationInTest % 10 === 0) {
    checkReadiness({
      baseUrl: config.baseUrl,
      timeout: "5s",
      metrics: readiness,
      scenario: "stress",
    });
  }
}
