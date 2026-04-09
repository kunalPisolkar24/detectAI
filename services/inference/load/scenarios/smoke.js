import grpc from "k6/net/grpc";
import { check, fail } from "k6";
import exec from "k6/execution";

import { buildSmokeOptions, getRuntimeConfig } from "../lib/config.js";
import { pickFixture } from "../lib/fixtures.js";
import { invokeDetect } from "../lib/grpc.js";
import { hasPredictionResult, hasValidPredictionLabel } from "../lib/prediction.js";

export const options = buildSmokeOptions();

export default function () {
  const runtimeConfig = getRuntimeConfig();
  const modelId = runtimeConfig.models[exec.scenario.iterationInTest % runtimeConfig.models.length];
  const fixture = pickFixture(runtimeConfig.textProfiles);
  const response = invokeDetect({
    text: fixture.text,
    modelId,
    tags: {
      scenario: "smoke",
      model: modelId,
      profile: fixture.profile,
    },
  });
  const checksPassed = check(response, {
    "grpc status ok": (value) => value && value.status === grpc.StatusOK,
    "prediction returned": (value) => Boolean(value && hasPredictionResult(value.message)),
    "prediction label valid": (value) => Boolean(value && hasValidPredictionLabel(value.message)),
  });

  if (!checksPassed) {
    fail(`Smoke detect failed for ${modelId} with ${fixture.profile}`);
  }
}
