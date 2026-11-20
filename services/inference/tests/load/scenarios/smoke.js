import { check, fail } from "k6";
import grpc from "k6/net/grpc";

import { getRuntimeConfig } from "../lib/config.js";
import { documentTags, documents, pickDocument } from "../lib/corpus.js";
import { invokeAnalyzeDocument, invokeDetect } from "../lib/grpc.js";
import { createStreamMetrics, createUnaryMetrics } from "../lib/metrics.js";
import { evaluateStreamResult, readField } from "../lib/stream.js";

const config = getRuntimeConfig();
const unary = createUnaryMetrics("inference_smoke_unary");
const stream = createStreamMetrics("inference_smoke_stream");

// Smoke always walks every bucket, including the naturally long rows that
// exercise multi-chunk streams, regardless of the load scenario's mix.
const SMOKE_PROFILES = ["short", "medium", "long", "xl"];

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ["rate==1"],
  },
  tags: { service: "inference", test_type: "smoke" },
};

export default async function () {
  const probe = documents[0];
  let failures = 0;

  for (const modelId of config.models) {
    const tags = { ...documentTags(probe), scenario: "smoke", model: modelId, rpc: "Detect" };
    const startedAt = Date.now();
    const response = invokeDetect({ text: probe.text, modelId, tags });
    unary.duration.add(Date.now() - startedAt, tags);
    const passed = check(response, {
      "grpc status ok": (value) => value && value.status === grpc.StatusOK,
      "model echoed": (value) => value && value.message &&
        readField(value.message, ["model_id", "modelId"]) === modelId,
      "verdict returned": (value) => value && value.message &&
        typeof readField(value.message, ["is_ai_generated", "isAiGenerated"]) === "boolean" &&
        Number.isFinite(readField(value.message, ["confidence_score", "confidenceScore"])),
    }, tags);
    unary.successRate.add(passed ? 1 : 0, tags);
    if (!passed) {
      unary.failures.add(1, { ...tags, status: String(response.status) });
      failures += 1;
    }
  }

  for (const modelId of config.models) {
    for (let index = 0; index < SMOKE_PROFILES.length; index += 1) {
      const document = pickDocument([SMOKE_PROFILES[index]], index);
      const tags = {
        ...documentTags(document),
        scenario: "smoke",
        model: modelId,
        rpc: "AnalyzeDocument",
      };
      const result = await invokeAnalyzeDocument({ text: document.text, modelId, tags });
      const evaluated = evaluateStreamResult(result, document, modelId, stream, tags);
      if (!evaluated.passed) {
        failures += 1;
      }
    }
  }

  const negativeCases = [
    { name: "missing key", metadata: {}, expected: grpc.StatusUnauthenticated },
    { name: "wrong key", metadata: { "x-api-key": "wrong-key-at-least-16-chars" },
      expected: grpc.StatusUnauthenticated },
    { name: "blank text", text: "   ", expected: grpc.StatusInvalidArgument },
    { name: "unknown model", modelId: "no-such-model", expected: grpc.StatusInvalidArgument },
  ];
  for (const testCase of negativeCases) {
    const tags = { scenario: "smoke", rpc: "Detect", case: testCase.name };
    const response = invokeDetect({
      text: testCase.text === undefined ? probe.text : testCase.text,
      modelId: testCase.modelId === undefined ? config.models[0] : testCase.modelId,
      metadata: testCase.metadata,
      tags,
    });
    if (!check(response, {
      "rejected with expected status": (value) => value && value.status === testCase.expected,
    }, tags)) {
      failures += 1;
    }
  }

  if (failures) {
    fail(`smoke had ${failures} failing check(s)`);
  }
}
