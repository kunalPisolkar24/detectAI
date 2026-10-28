import { sleep } from "k6";
import exec from "k6/execution";

import { getRuntimeConfig } from "./lib/config.js";
import { pickFixture } from "./lib/files.js";
import { createExtractMetrics, createReadinessMetrics } from "./lib/metrics.js";
import { checkHealth, checkReadiness, postExtract } from "./lib/requests.js";

// Legacy entrypoint preserved for `MODE=vus|rps` callers.
// New runs should use `SCENARIO=smoke|load|stress|soak|negative`
// (see scenarios/*). This file now shares the same lib helpers:
// deterministic round-robin fixtures, tagged metrics, explicit timeouts,
// and scenario-scoped thresholds so the background health probe no longer
// pollutes extract latency.
const metrics = createExtractMetrics("docparser_legacy");
const readiness = createReadinessMetrics("docparser_legacy_readiness");

const mode = (__ENV.MODE || "vus").toLowerCase();
const targetVUs = parseInt(__ENV.VUS) || 5;
const holdDuration = __ENV.DURATION || "10s";
const rampTime = __ENV.RAMP_TIME || "5s";
const targetRPS = parseInt(__ENV.RPS) || 10;

function extractionScenario() {
  if (mode === "rps") {
    return {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: Math.max(targetVUs, 20),
      maxVUs: Math.max(targetVUs * 2, 100),
      stages: [
        { duration: rampTime, target: targetRPS },
        { duration: holdDuration, target: targetRPS },
        { duration: rampTime, target: 0 },
      ],
      exec: "extract",
      tags: { service: "document-parser", test_type: "legacy-rps" },
    };
  }
  return {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: rampTime, target: targetVUs },
      { duration: holdDuration, target: targetVUs },
      { duration: rampTime, target: 0 },
    ],
    exec: "extract",
    tags: { service: "document-parser", test_type: "legacy-vus" },
  };
}

export const options = {
  scenarios: {
    health_check: {
      executor: "constant-vus",
      vus: 5,
      duration: "30s",
      exec: "health",
      tags: { service: "document-parser", test_type: "legacy-health" },
    },
    extraction_load: extractionScenario(),
  },
  thresholds: {
    // Scoped to the extract scenario so the health probe cannot skew latency.
    "http_req_duration{scenario:extraction_load}": ["p(95)<1500", "p(99)<3000"],
    "http_req_duration{scenario:health_check}": ["p(95)<1500", "p(99)<3000"],
    docparser_legacy_success_rate: ["rate>=0.99"],
    "docparser_legacy_duration{mime:text/plain}": ["p(95)<500"],
  },
};

export function health() {
  const config = getRuntimeConfig();
  checkHealth({ baseUrl: config.baseUrl, timeout: config.requestTimeout, scenario: "legacy" });
  sleep(1);
}

export function extract() {
  const config = getRuntimeConfig();
  const fixture = pickFixture(config.profiles);
  postExtract({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fixture,
    timeout: config.requestTimeout,
    metrics,
    scenario: "legacy",
  });

  if (exec.scenario.iterationInTest % 20 === 0) {
    checkReadiness({
      baseUrl: config.baseUrl,
      timeout: "5s",
      metrics: readiness,
      scenario: "legacy",
    });
  }

  if (mode !== "rps") {
    sleep(Math.random() * 2 + 1);
  }
}
