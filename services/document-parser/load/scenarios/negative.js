import { fail } from "k6";

import { getRuntimeConfig, readPositiveInt, readRatio } from "../lib/config.js";
import { pickNegativePayload } from "../lib/files.js";
import { createNegativeMetrics } from "../lib/metrics.js";
import { postNegative } from "../lib/requests.js";

const metrics = createNegativeMetrics("docparser_negative");

const minSuccessRate = readRatio("DOCPARSER_LOAD_NEGATIVE_MIN_SUCCESS_RATE", 1);

export const options = {
  scenarios: {
    negative: {
      executor: "shared-iterations",
      exec: "negativeScenario",
      vus: readPositiveInt("DOCPARSER_LOAD_NEGATIVE_VUS", 1),
      iterations: readPositiveInt("DOCPARSER_LOAD_NEGATIVE_ITERATIONS", 8),
      tags: {
        service: "document-parser",
        test_type: "negative",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    docparser_negative_success_rate: [`rate>=${minSuccessRate}`],
  },
};

export function negativeScenario() {
  const config = getRuntimeConfig();
  const payload = pickNegativePayload();
  const { passed, res } = postNegative({
    baseUrl: config.baseUrl,
    payload,
    timeout: config.requestTimeout,
    metrics,
    scenario: "negative",
  });
  if (!passed) {
    fail(`Negative case ${payload.case} unexpectedly returned status=${res.status}`);
  }
}
