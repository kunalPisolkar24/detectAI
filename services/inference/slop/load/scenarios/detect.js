import grpc from "k6/net/grpc";
import { check } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

import { getRuntimeConfig, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { pickFixture } from "../lib/fixtures.js";
import { invokeDetect } from "../lib/grpc.js";
import {
  hasBoundedPredictionConfidence,
  hasPredictionResult,
  hasValidPredictionLabel,
} from "../lib/prediction.js";

const detectDuration = new Trend("inference_load_detect_duration", true);
const detectFailures = new Counter("inference_load_detect_failures");
const detectSuccessRate = new Rate("inference_load_detect_success_rate");

const p95ThresholdMs = readPositiveInt("INFERENCE_LOAD_DETECT_P95_MS", 1500);
const p99ThresholdMs = readPositiveInt("INFERENCE_LOAD_DETECT_P99_MS", 2500);
const minSuccessRate = readRatio("INFERENCE_LOAD_DETECT_MIN_SUCCESS_RATE", 0.99);

export const options = {
  scenarios: {
    detect: {
      executor: "ramping-arrival-rate",
      exec: "detectScenario",
      startRate: readPositiveInt("INFERENCE_LOAD_DETECT_START_RATE", 1),
      timeUnit: "1s",
      preAllocatedVUs: readPositiveInt("INFERENCE_LOAD_DETECT_PREALLOCATED_VUS", 20),
      maxVUs: readPositiveInt("INFERENCE_LOAD_DETECT_MAX_VUS", 100),
      stages: readStages("INFERENCE_LOAD_DETECT_STAGES", "30s:5,1m:10,30s:0"),
      tags: {
        service: "inference",
        test_type: "load",
        rpc: "Detect",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    inference_load_detect_success_rate: [`rate>=${minSuccessRate}`],
    inference_load_detect_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  },
};

export function detectScenario() {
  const runtimeConfig = getRuntimeConfig();
  const modelId = runtimeConfig.models[exec.scenario.iterationInTest % runtimeConfig.models.length];
  const fixture = pickFixture(runtimeConfig.textProfiles);
  const tags = {
    scenario: "detect",
    model: modelId,
    profile: fixture.profile,
  };
  const startedAt = Date.now();
  const response = invokeDetect({
    text: fixture.text,
    modelId,
    tags,
  });
  const duration = Date.now() - startedAt;

  detectDuration.add(duration, tags);

  const passed = check(
    response,
    {
      "grpc status ok": (value) => value && value.status === grpc.StatusOK,
      "prediction returned": (value) => Boolean(value && hasPredictionResult(value.message)),
      "prediction label valid": (value) => Boolean(value && hasValidPredictionLabel(value.message)),
      "confidence bounded": (value) => Boolean(value && hasBoundedPredictionConfidence(value.message)),
    },
    tags,
  );

  detectSuccessRate.add(passed ? 1 : 0, tags);

  if (!passed) {
    detectFailures.add(1, {
      ...tags,
      status: response && response.status !== undefined ? String(response.status) : "unknown",
    });
  }
}
