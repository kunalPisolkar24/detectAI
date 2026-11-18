import { check } from "k6";
import grpc from "k6/net/grpc";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

import { getRuntimeConfig } from "./config.js";
import { pickFixture } from "./fixtures.js";
import { invokeAnalyzeDocumentStream } from "./grpc.js";
import {
  getAiConfidence,
  getConfidenceScore,
  getHumanConfidence,
  getIsAiGenerated,
  getLabel,
  hasPredictionResult,
  hasValidPredictionLabel,
} from "./prediction.js";

const CONFIDENCE_TOLERANCE = 0.2;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function readField(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) {
      return value[name];
    }
  }

  return undefined;
}

function getTotalChars(value) {
  return readField(value, ["totalChars", "total_chars"]);
}

function getTotalChunks(value) {
  return readField(value, ["totalChunks", "total_chunks"]);
}

function getProcessedChunks(value) {
  return readField(value, ["processedChunks", "processed_chunks"]);
}

function isBoundedPercentage(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function approximatelyEqual(left, right, tolerance = CONFIDENCE_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function formatGrpcStatus(status) {
  switch (status) {
    case grpc.StatusOK:
      return "OK";
    case grpc.StatusCanceled:
      return "CANCELED";
    case grpc.StatusInvalidArgument:
      return "INVALID_ARGUMENT";
    case grpc.StatusDeadlineExceeded:
      return "DEADLINE_EXCEEDED";
    case grpc.StatusResourceExhausted:
      return "RESOURCE_EXHAUSTED";
    case grpc.StatusUnavailable:
      return "UNAVAILABLE";
    case grpc.StatusUnauthenticated:
      return "UNAUTHENTICATED";
    case grpc.StatusInternal:
      return "INTERNAL";
    default:
      return status === undefined || status === null ? "UNKNOWN" : String(status);
  }
}

export function createAnalyzeMetrics(prefix) {
  return {
    duration: new Trend(`${prefix}_duration`, true),
    timeToFirstEvent: new Trend(`${prefix}_time_to_first_event`, true),
    eventCount: new Trend(`${prefix}_event_count`),
    failures: new Counter(`${prefix}_failures`),
    successRate: new Rate(`${prefix}_success_rate`),
  };
}

export function summarizeAnalyzeDocumentStream(result) {
  const summary = {
    eventCount: result.events.length,
    started: null,
    progressEvents: [],
    final: null,
    unknownEventCount: 0,
    startedFirst: false,
    finalLast: false,
    startedValid: false,
    progressMonotonic: true,
    progressTotalsConsistent: true,
    progressWithinBounds: true,
    progressComplete: false,
    finalValid: false,
    finalConfidenceConsistent: false,
    streamCompleted: result.status === grpc.StatusOK && !result.timedOut && !result.error,
  };

  for (const event of result.events) {
    if (event.type === "started") {
      summary.started = event.message.started;
      continue;
    }

    if (event.type === "progress") {
      summary.progressEvents.push(event.message.progress);
      continue;
    }

    if (event.type === "final") {
      summary.final = event.message.final;
      continue;
    }

    summary.unknownEventCount += 1;
  }

  const eventTypes = result.events.map((event) => event.type);
  summary.startedFirst = eventTypes[0] === "started";
  summary.finalLast = eventTypes[eventTypes.length - 1] === "final";
  summary.startedValid = Boolean(
    summary.started &&
      isPositiveInteger(getTotalChars(summary.started)) &&
      isPositiveInteger(getTotalChunks(summary.started)),
  );

  let previousProcessed = 0;

  for (const progress of summary.progressEvents) {
    const processedChunks = getProcessedChunks(progress);
    const totalChunks = getTotalChunks(progress);

    if (!isPositiveInteger(processedChunks) || !isPositiveInteger(totalChunks)) {
      summary.progressWithinBounds = false;
      continue;
    }

    if (summary.startedValid && totalChunks !== getTotalChunks(summary.started)) {
      summary.progressTotalsConsistent = false;
    }

    if (processedChunks > totalChunks) {
      summary.progressWithinBounds = false;
    }

    if (processedChunks <= previousProcessed) {
      summary.progressMonotonic = false;
    }

    previousProcessed = processedChunks;
  }

  const finalProgress = summary.progressEvents[summary.progressEvents.length - 1];
  summary.progressComplete = Boolean(
    summary.startedValid &&
      finalProgress &&
      getProcessedChunks(finalProgress) === getTotalChunks(summary.started) &&
      getTotalChunks(finalProgress) === getTotalChunks(summary.started),
  );

  summary.finalValid = Boolean(
    summary.final &&
      hasPredictionResult(summary.final) &&
      hasValidPredictionLabel(summary.final) &&
      isBoundedPercentage(getConfidenceScore(summary.final)) &&
      isBoundedPercentage(getHumanConfidence(summary.final)) &&
      isBoundedPercentage(getAiConfidence(summary.final)),
  );

  if (summary.finalValid) {
    const label = getLabel(summary.final);
    const expectedLabel = getIsAiGenerated(summary.final) ? "AI" : "Human";
    const expectedConfidence = label === "AI" ? getAiConfidence(summary.final) : getHumanConfidence(summary.final);

    summary.finalConfidenceConsistent =
      label === expectedLabel &&
      approximatelyEqual(getAiConfidence(summary.final) + getHumanConfidence(summary.final), 100) &&
      approximatelyEqual(getConfidenceScore(summary.final), expectedConfidence);
  }

  return summary;
}

function inferAnalyzeFailureReason(result, summary) {
  if (result.timedOut) {
    return "timeout";
  }

  if (result.error) {
    return `grpc_${formatGrpcStatus(result.status).toLowerCase()}`;
  }

  if (!summary.startedFirst) {
    return "started_missing_or_out_of_order";
  }

  if (!summary.startedValid) {
    return "started_invalid";
  }

  if (!summary.progressWithinBounds) {
    return "progress_out_of_bounds";
  }

  if (!summary.progressTotalsConsistent) {
    return "progress_total_mismatch";
  }

  if (!summary.progressMonotonic) {
    return "progress_not_monotonic";
  }

  if (!summary.progressComplete) {
    return "progress_incomplete";
  }

  if (!summary.finalLast) {
    return "final_missing_or_out_of_order";
  }

  if (!summary.finalValid) {
    return "final_invalid";
  }

  if (!summary.finalConfidenceConsistent) {
    return "final_confidence_inconsistent";
  }

  if (summary.unknownEventCount > 0) {
    return "unknown_event";
  }

  return "stream_check_failed";
}

export function evaluateAnalyzeDocumentStream(result, metrics, tags) {
  const summary = summarizeAnalyzeDocumentStream(result);

  metrics.duration.add(result.durationMs, tags);

  if (result.timeToFirstEventMs !== null) {
    metrics.timeToFirstEvent.add(result.timeToFirstEventMs, tags);
  }

  metrics.eventCount.add(summary.eventCount, tags);

  const passed = check(
    summary,
    {
      "stream status ok": () => summary.streamCompleted,
      "started event first and valid": () => summary.startedFirst && summary.startedValid,
      "progress monotonic and bounded": () =>
        summary.progressWithinBounds && summary.progressTotalsConsistent && summary.progressMonotonic,
      "progress reaches declared total": () => summary.progressComplete,
      "final event last and valid": () =>
        summary.finalLast && summary.finalValid && summary.finalConfidenceConsistent,
      "no unknown stream events": () => summary.unknownEventCount === 0,
    },
    tags,
  );

  metrics.successRate.add(passed ? 1 : 0, tags);

  if (!passed) {
    metrics.failures.add(1, {
      ...tags,
      status: formatGrpcStatus(result.status),
      reason: inferAnalyzeFailureReason(result, summary),
    });
  }

  return {
    passed,
    summary,
  };
}

export async function runAnalyzeDocumentIteration({ scenario, metrics }) {
  const runtimeConfig = getRuntimeConfig();
  const modelId = runtimeConfig.models[exec.scenario.iterationInTest % runtimeConfig.models.length];
  const fixture = pickFixture(runtimeConfig.textProfiles);
  const tags = {
    scenario,
    model: modelId,
    profile: fixture.profile,
  };
  const result = await invokeAnalyzeDocumentStream({
    text: fixture.text,
    modelId,
    tags,
  });

  return evaluateAnalyzeDocumentStream(result, metrics, tags);
}
