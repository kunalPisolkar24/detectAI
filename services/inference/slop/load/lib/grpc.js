import grpc from "k6/net/grpc";

import { getRuntimeConfig } from "./config.js";

const client = new grpc.Client();
client.load(["../protos"], "../protos/ai_service.proto");
let connected = false;

function metadata() {
  const runtimeConfig = getRuntimeConfig();

  return {
    authorization: `Bearer ${runtimeConfig.authToken}`,
  };
}

export function ensureConnected() {
  const runtimeConfig = getRuntimeConfig();

  if (!connected) {
    client.connect(runtimeConfig.target, {
      plaintext: runtimeConfig.plaintext,
      timeout: runtimeConfig.connectTimeout,
    });
    connected = true;
  }

  return client;
}

export function invokeDetect({ text, modelId, tags = {} }) {
  const runtimeConfig = getRuntimeConfig();

  return ensureConnected().invoke(
    "aidetection.AIService/Detect",
    {
      text,
      model_id: modelId,
    },
    {
      metadata: metadata(),
      tags,
      timeout: runtimeConfig.rpcTimeout,
    },
  );
}

function hasOwnField(value, field) {
  return Boolean(
    value &&
      Object.prototype.hasOwnProperty.call(value, field) &&
      value[field] !== null &&
      value[field] !== undefined,
  );
}

function getAnalyzeEventType(message) {
  if (message && typeof message.event === "string") {
    return message.event;
  }

  if (hasOwnField(message, "started")) {
    return "started";
  }

  if (hasOwnField(message, "progress")) {
    return "progress";
  }

  if (hasOwnField(message, "final")) {
    return "final";
  }

  return "unknown";
}

function normalizeStreamError(error) {
  return {
    code: error && error.code !== undefined ? error.code : grpc.StatusUnknown,
    details: error && Array.isArray(error.details) ? error.details : [],
    message: error && error.message ? String(error.message) : "Unknown stream error",
  };
}

function buildAnalyzeStreamResult(startedAt) {
  return {
    status: grpc.StatusOK,
    startedAt,
    endedAt: null,
    durationMs: null,
    firstEventAt: null,
    timeToFirstEventMs: null,
    timedOut: false,
    error: null,
    events: [],
  };
}

function completeAnalyzeStream(result, status, error = null) {
  if (result.endedAt !== null) {
    return;
  }

  result.status = status;
  result.error = error;
  result.endedAt = Date.now();
  result.durationMs = result.endedAt - result.startedAt;
  result.timeToFirstEventMs =
    result.firstEventAt === null ? null : Math.max(0, result.firstEventAt - result.startedAt);
}

export function invokeAnalyzeDocumentStream({ text, modelId, tags = {}, timeoutMs }) {
  const runtimeConfig = getRuntimeConfig();
  const streamTimeoutMs = timeoutMs || runtimeConfig.rpcTimeoutMs;
  const result = buildAnalyzeStreamResult(Date.now());
  const stream = new grpc.Stream(ensureConnected(), "aidetection.AIService/AnalyzeDocument", {
    metadata: metadata(),
    tags,
    timeout: runtimeConfig.rpcTimeout,
  });

  return new Promise((resolve) => {
    let timeoutId;

    function finish(status, error = null, { closeAfter = false } = {}) {
      if (result.endedAt !== null) {
        return;
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      completeAnalyzeStream(result, status, error);

      if (closeAfter) {
        closeClient();
      }

      resolve(result);
    }

    stream.on("data", (message) => {
      if (result.firstEventAt === null) {
        result.firstEventAt = Date.now();
      }

      const eventType = getAnalyzeEventType(message);
      result.events.push({
        type: eventType,
        message,
      });

      if (eventType === "final") {
        finish(grpc.StatusOK);
      }
    });

    stream.on("error", (error) => {
      finish(
        error && error.code !== undefined ? error.code : grpc.StatusUnknown,
        normalizeStreamError(error),
      );
    });

    stream.on("end", () => {
      finish(grpc.StatusOK);
    });

    timeoutId = setTimeout(() => {
      result.timedOut = true;
      finish(
        grpc.StatusDeadlineExceeded,
        {
          code: grpc.StatusDeadlineExceeded,
          details: [],
          message: `AnalyzeDocument stream timed out after ${streamTimeoutMs}ms`,
        },
        { closeAfter: true },
      );
    }, streamTimeoutMs);

    try {
      stream.write({
        text,
        model_id: modelId,
      });
      stream.end();
    } catch (error) {
      finish(grpc.StatusUnknown, normalizeStreamError(error));
    }
  });
}

export function closeClient() {
  if (!connected) {
    return;
  }

  client.close();
  connected = false;
}
