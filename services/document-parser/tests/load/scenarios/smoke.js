import { fail } from "k6";

import { getRuntimeConfig } from "../lib/config.js";
import { negativePayloads, pickFixture } from "../lib/files.js";
import { createExtractMetrics, createNegativeMetrics } from "../lib/metrics.js";
import { checkHealth, postExtract, postNegative } from "../lib/requests.js";

const metrics = createExtractMetrics("docparser_smoke");
const rejections = createNegativeMetrics("docparser_smoke_rejection");

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // One pass ticks both families below; any unexpected answer ends the run.
    checks: ["rate==1"],
  },
  tags: {
    service: "document-parser",
    test_type: "smoke",
  },
};

// The formats' admission is what varies, so the smoke posts one small row
// per format; the configured mix's first row keeps a customized DOCPARSER_
// LOAD_PROFILES line verified too.
const SMOKE_PROFILES = ["short.txt", "short.pdf", "short.docx"];

// The functional gate: a healthy deployment, a 200 extraction per format,
// and the full rejection matrix with its exact statuses — every request of
// this single pass is asserted, so any surprise fails the run.
export default function () {
  const config = getRuntimeConfig();

  if (!checkHealth({ baseUrl: config.baseUrl, timeout: config.requestTimeout, scenario: "smoke" })) {
    fail("Smoke health check failed");
  }

  for (const profile of SMOKE_PROFILES) {
    const fixture = pickFixture([profile]);
    const { passed, res } = postExtract({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      fixture,
      timeout: config.requestTimeout,
      metrics,
      scenario: "smoke",
    });
    if (!passed) {
      fail(`Smoke extract failed for ${profile}: status=${res.status}`);
    }
  }

  // Deterministic round-robin still gets one slot for the configured mix.
  const mixed = pickFixture(config.profiles);
  if (!SMOKE_PROFILES.includes(mixed.profile)) {
    const { passed, res } = postExtract({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      fixture: mixed,
      timeout: config.requestTimeout,
      metrics,
      scenario: "smoke",
    });
    if (!passed) {
      fail(`Smoke extract failed for configured profile ${mixed.profile}: status=${res.status}`);
    }
  }

  for (const payload of negativePayloads()) {
    const { passed, res } = postNegative({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      payload,
      timeout: config.requestTimeout,
      metrics: rejections,
      scenario: "smoke",
    });
    if (!passed) {
      fail(`Smoke case ${payload.case} unexpectedly returned status=${res.status}`);
    }
  }
}
