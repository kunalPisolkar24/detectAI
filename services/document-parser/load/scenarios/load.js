import { sleep } from "k6";
import exec from "k6/execution";

import { getRuntimeConfig, readDuration, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { pickFixture } from "../lib/files.js";
import { createExtractMetrics } from "../lib/metrics.js";
import { postExtract } from "../lib/requests.js";

const metrics = createExtractMetrics("docparser_load");

const p95ThresholdMs = readPositiveInt("DOCPARSER_LOAD_P95_MS", 1500);
const p99ThresholdMs = readPositiveInt("DOCPARSER_LOAD_P99_MS", 3000);
const txtP95ThresholdMs = readPositiveInt("DOCPARSER_LOAD_TXT_P95_MS", 500);
const minSuccessRate = readRatio("DOCPARSER_LOAD_MIN_SUCCESS_RATE", 0.99);

export const options = {
  scenarios: {
    load: {
      executor: "ramping-vus",
      exec: "loadScenario",
      startVUs: 0,
      stages: readStages("DOCPARSER_LOAD_STAGES", "5s:5,10s:5,5s:0"),
      gracefulStop: readDuration("DOCPARSER_LOAD_GRACEFUL_STOP", "30s"),
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
    "docparser_load_duration{mime:text/plain}": [`p(95)<${txtP95ThresholdMs}`],
  },
};

export function loadScenario() {
  const config = getRuntimeConfig();
  const fixture = pickFixture(config.profiles);
  postExtract({
    baseUrl: config.baseUrl,
    fixture,
    timeout: config.requestTimeout,
    metrics,
    scenario: "load",
  });
  if (exec.scenario.executor !== "ramping-arrival-rate") {
    sleep(Math.random() * 2 + 1);
  }
}
