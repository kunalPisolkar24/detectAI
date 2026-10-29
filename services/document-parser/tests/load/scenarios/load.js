import exec from "k6/execution";

import { getRuntimeConfig, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { pickFixture } from "../lib/files.js";
import { createExtractMetrics, createReadinessMetrics } from "../lib/metrics.js";
import { checkReadiness, postExtract } from "../lib/requests.js";

const metrics = createExtractMetrics("docparser_load");
const readiness = createReadinessMetrics("docparser_load_readiness");

const p95ThresholdMs = readPositiveInt("DOCPARSER_LOAD_P95_MS", 1500);
const p99ThresholdMs = readPositiveInt("DOCPARSER_LOAD_P99_MS", 3000);
const minSuccessRate = readRatio("DOCPARSER_LOAD_MIN_SUCCESS_RATE", 0.99);

// The shape dial: duration:arrivals-per-second steps read from the file. A
// ramp, a tall spike, and a flat marathon are edits of the same STAGES key;
// the first entry seeds the start rate.
const stages = readStages("STAGES", "5s:5,10s:5,5s:0");

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      exec: "loadScenario",
      startRate: stages[0].target,
      timeUnit: "1s",
      // k6 grows the VU pool on demand up to the ceiling; the ceiling is the
      // file's burst headroom (MAX_VUS).
      preAllocatedVUs: readPositiveInt("MAX_VUS", 100),
      maxVUs: readPositiveInt("MAX_VUS", 100),
      stages,
      gracefulStop: "30s",
      tags: {
        service: "document-parser",
        test_type: "load",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    docparser_load_success_rate: [`rate>=${minSuccessRate}`],
    docparser_load_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  },
};

export function loadScenario() {
  const config = getRuntimeConfig();
  const fixture = pickFixture(config.profiles);
  postExtract({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fixture,
    timeout: config.requestTimeout,
    metrics,
    scenario: "load",
  });

  // Sample backpressure every 10th arrival without doubling request volume.
  if (exec.scenario.iterationInTest % 10 === 0) {
    checkReadiness({
      baseUrl: config.baseUrl,
      timeout: "5s",
      metrics: readiness,
      scenario: "load",
    });
  }
}
