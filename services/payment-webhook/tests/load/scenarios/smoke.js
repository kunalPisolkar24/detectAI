import { fail } from "k6";

import { getRuntimeConfig } from "../lib/config.js";
import { buildAdvisoryRequest, buildSignedRequest, negativePayloads, pickProfile } from "../lib/payloads.js";
import { createRejectionMetrics, createWebhookMetrics } from "../lib/metrics.js";
import { checkHealth, postQueued, postRejected } from "../lib/requests.js";

const metrics = createWebhookMetrics("webhook_load_smoke");
const rejections = createRejectionMetrics("webhook_load_smoke_rejection");

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ["rate==1"],
  },
  tags: {
    service: "payment-webhook",
    test_type: "smoke",
  },
};

// One valid body per profile; a configured mix keeps its own slot too.
const SMOKE_PROFILES = ["small", "mid", "large", "near-limit"];

// The functional gate: health, one 200 per profile, the advisory row, the full rejection matrix.
export default function () {
  const config = getRuntimeConfig();

  if (!checkHealth({ baseUrl: config.baseUrl, timeout: config.requestTimeout, scenario: "smoke" })) {
    fail("Smoke health check failed");
  }

  for (const [index, profile] of SMOKE_PROFILES.entries()) {
    const request = buildSignedRequest(config, {
      profile,
      eventId: `evt_smoke_${profile}`,
      eventType: config.eventTypes[index % config.eventTypes.length],
      seed: index,
    });
    const { passed, res } = postQueued({
      baseUrl: config.baseUrl,
      request,
      timeout: config.requestTimeout,
      timeoutMs: config.requestTimeoutMs,
      metrics,
      scenario: "smoke",
    });
    if (!passed) {
      fail(`Smoke webhook failed for ${profile}: status=${res.status}`);
    }
  }

  // Deterministic round-robin still gets one slot for the configured mix.
  const mixedProfile = pickProfile(config);
  if (!SMOKE_PROFILES.includes(mixedProfile)) {
    const request = buildSignedRequest(config, {
      profile: mixedProfile,
      eventId: `evt_smoke_${mixedProfile}`,
      eventType: config.eventTypes[0],
    });
    const { passed, res } = postQueued({
      baseUrl: config.baseUrl,
      request,
      timeout: config.requestTimeout,
      timeoutMs: config.requestTimeoutMs,
      metrics,
      scenario: "smoke",
    });
    if (!passed) {
      fail(`Smoke webhook failed for configured profile ${mixedProfile}: status=${res.status}`);
    }
  }

  const advisory = buildAdvisoryRequest(config, {
    eventId: "evt_smoke_advisory",
    eventType: config.eventTypes[0],
  });
  const advisoryRun = postQueued({
    baseUrl: config.baseUrl,
    request: advisory,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: "smoke",
  });
  if (!advisoryRun.passed) {
    fail(`Smoke advisory case unexpectedly returned status=${advisoryRun.res.status}`);
  }

  for (const request of negativePayloads(config)) {
    const { passed, res } = postRejected({
      baseUrl: config.baseUrl,
      request,
      timeout: config.requestTimeout,
      metrics: rejections,
      scenario: "smoke",
    });
    if (!passed) {
      fail(`Smoke case ${request.case} unexpectedly returned status=${res.status}`);
    }
  }
}
