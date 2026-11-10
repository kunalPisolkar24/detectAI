import exec from "k6/execution";

import { getRuntimeConfig, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { buildSignedRequest, pickProfile } from "../lib/payloads.js";
import { createReadinessMetrics, createWebhookMetrics } from "../lib/metrics.js";
import { checkReadiness, postQueued } from "../lib/requests.js";

const metrics = createWebhookMetrics("webhook_load_payload");
const readiness = createReadinessMetrics("webhook_load_readiness");

const p95ThresholdMs = readPositiveInt("WEBHOOK_LOAD_P95_MS", 1000);
const p99ThresholdMs = readPositiveInt("WEBHOOK_LOAD_P99_MS", 2000);
const minSuccessRate = readRatio("WEBHOOK_LOAD_MIN_SUCCESS_RATE", 0.99);

// The shape dial: duration:rate steps read from STAGES; the first entry seeds the start rate.
const stages = readStages("STAGES", "5s:1,10s:2,5s:0");

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      exec: "loadScenario",
      startRate: stages[0].target,
      timeUnit: "1s",
      // The VU pool grows on demand up to the file's burst headroom (MAX_VUS).
      preAllocatedVUs: readPositiveInt("MAX_VUS", 100),
      maxVUs: readPositiveInt("MAX_VUS", 100),
      stages,
      gracefulStop: "30s",
      tags: {
        service: "payment-webhook",
        test_type: "load",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    webhook_load_payload_success_rate: [`rate>=${minSuccessRate}`],
    webhook_load_payload_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  },
};

// Every arrival signs and posts its own body with a unique event id so queue dedup eats nothing.
export function loadScenario() {
  const config = getRuntimeConfig();
  const iteration = exec.scenario.iterationInTest;
  const request = buildSignedRequest(config, {
    profile: pickProfile(config, iteration),
    eventId: `evt_load_${Date.now()}_${iteration}`,
    eventType: config.eventTypes[iteration % config.eventTypes.length],
    seed: iteration,
  });
  postQueued({
    baseUrl: config.baseUrl,
    request,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: "load",
  });

  // Sample backpressure every 10th arrival without doubling request volume.
  if (iteration % 10 === 0) {
    checkReadiness({
      baseUrl: config.baseUrl,
      timeout: "5s",
      metrics: readiness,
      scenario: "load",
    });
  }
}
