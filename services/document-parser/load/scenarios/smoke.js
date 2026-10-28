import { fail, sleep } from "k6";

import { getRuntimeConfig, readPositiveInt } from "../lib/config.js";
import { pickFixture } from "../lib/files.js";
import { createExtractMetrics } from "../lib/metrics.js";
import { checkHealth, postExtract } from "../lib/requests.js";

const metrics = createExtractMetrics("docparser_smoke");

export const options = {
  vus: readPositiveInt(["DOCPARSER_LOAD_SMOKE_VUS", "VUS"], 1),
  iterations: readPositiveInt(["DOCPARSER_LOAD_SMOKE_ITERATIONS", "ITERATIONS"], 1),
  thresholds: {
    checks: ["rate==1"],
  },
  tags: {
    service: "document-parser",
    test_type: "smoke",
  },
};

const SMOKE_PROFILES = ["txt-small", "pdf-small", "docx-small"];

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
    sleep(0.5);
  }

  // Deterministic round-robin still gets one iteration for the configured mix.
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
}
