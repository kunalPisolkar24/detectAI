import { sleep } from "k6";

import { getRuntimeConfig, readDuration, readPositiveInt, readRatio } from "../lib/config.js";
import { pickFixture } from "../lib/files.js";
import { createExtractMetrics, createReadinessMetrics } from "../lib/metrics.js";
import { checkReadiness, postExtract } from "../lib/requests.js";

const metrics = createExtractMetrics("docparser_soak");
const readiness = createReadinessMetrics("docparser_soak_readiness");

const p95ThresholdMs = readPositiveInt("DOCPARSER_LOAD_SOAK_P95_MS", 3000);
const p99ThresholdMs = readPositiveInt("DOCPARSER_LOAD_SOAK_P99_MS", 5000);
const minSuccessRate = readRatio("DOCPARSER_LOAD_SOAK_MIN_SUCCESS_RATE", 0.99);

export const options = {
  scenarios: {
    soak: {
      executor: "constant-vus",
      exec: "soakScenario",
      vus: readPositiveInt(["DOCPARSER_LOAD_SOAK_VUS", "VUS"], 2),
      duration: readDuration(["DOCPARSER_LOAD_SOAK_DURATION", "DURATION"], "5m"),
      gracefulStop: readDuration("DOCPARSER_LOAD_SOAK_GRACEFUL_STOP", "30s"),
      tags: {
        service: "document-parser",
        test_type: "soak",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    docparser_soak_success_rate: [`rate>=${minSuccessRate}`],
    docparser_soak_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  },
};

export function soakScenario() {
  const config = getRuntimeConfig();
  const fixture = pickFixture(config.profiles);
  postExtract({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fixture,
    timeout: config.requestTimeout,
    metrics,
    scenario: "soak",
  });
  checkReadiness({
    baseUrl: config.baseUrl,
    timeout: "5s",
    metrics: readiness,
    scenario: "soak",
  });
  sleep(Math.random() * 2 + 1);
}
