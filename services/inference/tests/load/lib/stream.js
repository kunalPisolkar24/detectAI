import { check } from "k6";
import grpc from "k6/net/grpc";

export function readField(value, names) {
  for (const name of names) {
    if (value && value[name] !== undefined && value[name] !== null) {
      return value[name];
    }
  }
  return undefined;
}

function classify(message) {
  if (message && message.started) {
    return "started";
  }
  if (message && message.progress) {
    return "progress";
  }
  if (message && message.result) {
    return "result";
  }
  return "unknown";
}

// proto3 JSON drops zero-valued scalars, so an absent numeric field is zero.
function numberField(value, names) {
  const found = readField(value, names);
  return found === undefined ? 0 : found;
}

function isInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function inConfidenceRange(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function formatStatus(status) {
  const names = {
    [grpc.StatusOK]: "OK",
    [grpc.StatusCanceled]: "CANCELLED",
    [grpc.StatusInvalidArgument]: "INVALID_ARGUMENT",
    [grpc.StatusDeadlineExceeded]: "DEADLINE_EXCEEDED",
    [grpc.StatusResourceExhausted]: "RESOURCE_EXHAUSTED",
    [grpc.StatusUnavailable]: "UNAVAILABLE",
    [grpc.StatusUnauthenticated]: "UNAUTHENTICATED",
    [grpc.StatusInternal]: "INTERNAL",
  };
  return names[status] || (status === undefined || status === null ? "UNKNOWN" : String(status));
}

export function summarizeStream(result, document, modelId) {
  const events = result.events;
  const types = events.map(classify);
  const started = events.find((event) => classify(event) === "started");
  const progress = events.filter((event) => classify(event) === "progress");
  const resultEvent = events.find((event) => classify(event) === "result");
  const totalChunks = document.expected_total_chunks;
  const totalChars = document.expected_total_chars;

  const startedTotalChars = started && numberField(started.started, ["total_chars", "totalChars"]);
  const startedTotalChunks = started && numberField(started.started, ["total_chunks", "totalChunks"]);

  let previousProcessed = 0;
  const progressWithinBounds = progress.every((event) => {
    const processed = numberField(event.progress, ["processed_chunks", "processedChunks"]);
    const total = numberField(event.progress, ["total_chunks", "totalChunks"]);
    const valid = isInteger(processed) && isInteger(total) && total === totalChunks &&
      processed <= total && processed > previousProcessed;
    if (valid) {
      previousProcessed = processed;
    }
    return valid;
  });

  const spans = resultEvent
    ? readField(resultEvent.result, ["highlight_spans", "highlightSpans"]) || []
    : [];
  const spansInBounds = spans.every((span) => {
    const start = numberField(span, ["char_start", "charStart"]);
    const end = numberField(span, ["char_end", "charEnd"]);
    return Number.isInteger(start) && Number.isInteger(end) &&
      start >= 0 && end > start && end <= totalChars;
  });

  const ai = resultEvent && numberField(resultEvent.result, ["ai_confidence", "aiConfidence"]);
  const human = resultEvent && numberField(resultEvent.result, ["human_confidence", "humanConfidence"]);
  const score = resultEvent && numberField(resultEvent.result, ["confidence_score", "confidenceScore"]);
  const echoedModel = resultEvent && readField(resultEvent.result, ["model_id", "modelId"]);

  const resultValid = Boolean(
    resultEvent &&
    echoedModel === modelId &&
    inConfidenceRange(ai) && inConfidenceRange(human) && inConfidenceRange(score) &&
    Math.abs(score - Math.max(ai, human)) <= 0.2 &&
    spansInBounds
  );

  const lastProgress = progress[progress.length - 1];
  const lastProcessed = lastProgress &&
    numberField(lastProgress.progress, ["processed_chunks", "processedChunks"]);

  return {
    streamCompleted: result.status === grpc.StatusOK && !result.error && result.endedAt !== null,
    backpressure: result.status === grpc.StatusResourceExhausted,
    startedFirst: types[0] === "started",
    startedValid: Boolean(
      started && isInteger(startedTotalChunks) && startedTotalChunks === totalChunks &&
      startedTotalChars === totalChars
    ),
    progressWithinBounds,
    progressComplete: Boolean(progress.length && lastProcessed === totalChunks),
    resultLast: types[types.length - 1] === "result" &&
      types.filter((type) => type === "result").length === 1,
    resultValid,
    noUnknownEvents: !types.includes("unknown"),
    durationMs: result.endedAt === null ? 0 : result.endedAt - result.startedAt,
    timeToFirstEventMs: result.firstEventAt === null
      ? null
      : Math.max(0, result.firstEventAt - result.startedAt),
    eventCount: events.length,
    chunkCount: totalChunks,
    status: formatStatus(result.status),
  };
}

function reasonFor(summary) {
  for (const name of [
    "streamCompleted", "startedFirst", "startedValid", "progressWithinBounds",
    "progressComplete", "resultLast", "resultValid", "noUnknownEvents",
  ]) {
    if (!summary[name]) {
      return name;
    }
  }
  return "stream_check_failed";
}

const STREAM_CHECKS = {
  "stream completed": (summary) => summary.streamCompleted,
  "started first and matches corpus": (summary) => summary.startedFirst && summary.startedValid,
  "progress bounded and complete": (summary) =>
    summary.progressWithinBounds && summary.progressComplete,
  "result last and well formed": (summary) => summary.resultLast && summary.resultValid,
  "no unknown events": (summary) => summary.noUnknownEvents,
};

export function evaluateStreamResult(result, document, modelId, metrics, tags) {
  const summary = summarizeStream(result, document, modelId);

  metrics.duration.add(summary.durationMs, tags);
  metrics.eventCount.add(summary.eventCount, tags);
  if (summary.timeToFirstEventMs !== null) {
    metrics.timeToFirstEvent.add(summary.timeToFirstEventMs, tags);
  }
  if (summary.startedValid) {
    metrics.chunkCount.add(summary.chunkCount, tags);
  }

  let passed;
  if (summary.backpressure) {
    metrics.backpressure.add(1, tags);
    passed = check({ backpressure: true }, { "shed under backpressure": () => true }, tags);
  } else {
    passed = check(summary, STREAM_CHECKS, tags);
    metrics.successRate.add(passed ? 1 : 0, tags);
    if (!passed) {
      metrics.failures.add(1, { ...tags, status: summary.status, reason: reasonFor(summary) });
    }
  }
  return { passed, summary };
}
