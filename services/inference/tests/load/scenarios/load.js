import exec from "k6/execution";

import { getRuntimeConfig, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { documentTags, pickDocument } from "../lib/corpus.js";
import { invokeAnalyzeDocument } from "../lib/grpc.js";
import { createStreamMetrics } from "../lib/metrics.js";
import { evaluateStreamResult } from "../lib/stream.js";

const metrics = createStreamMetrics("inference_load");

const stages = readStages("INFERENCE_LOAD_STAGES", "5s:1,10s:1,5s:0");
const maxVUs = readPositiveInt("INFERENCE_LOAD_MAX_VUS", 4);
const minSuccessRate = readRatio("INFERENCE_LOAD_MIN_SUCCESS_RATE", 0.95);
const p95Ms = readPositiveInt("INFERENCE_LOAD_P95_MS", 60000);
const p99Ms = readPositiveInt("INFERENCE_LOAD_P99_MS", 90000);
const ttfcP95Ms = readPositiveInt("INFERENCE_LOAD_TTFC_P95_MS", 10000);

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      exec: "loadScenario",
      startRate: stages[0].target,
      timeUnit: "1s",
      preAllocatedVUs: maxVUs,
      maxVUs,
      stages,
      gracefulStop: "30s",
      tags: { service: "inference", test_type: "load", rpc: "AnalyzeDocument" },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    inference_load_success_rate: [`rate>=${minSuccessRate}`],
    inference_load_duration: [`p(95)<${p95Ms}`, `p(99)<${p99Ms}`],
    inference_load_time_to_first_event: [`p(95)<${ttfcP95Ms}`],
  },
};

export async function loadScenario() {
  const config = getRuntimeConfig();
  const document = pickDocument(config.profiles);
  const modelId = config.models[exec.scenario.iterationInTest % config.models.length];
  const tags = { ...documentTags(document), scenario: "load", model: modelId };
  const result = await invokeAnalyzeDocument({ text: document.text, modelId, tags });
  evaluateStreamResult(result, document, modelId, metrics, tags);
}
