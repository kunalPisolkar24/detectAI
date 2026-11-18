import grpc from "k6/net/grpc";

import { getRuntimeConfig } from "./config.js";

const config = getRuntimeConfig();
const client = new grpc.Client();
client.load([config.protoDir], "ai_service.proto");

let connected = false;

function metadataFor(apiKey) {
  return apiKey === null ? {} : { "x-api-key": apiKey === undefined ? config.apiKey : apiKey };
}

function ensureConnected() {
  if (!connected) {
    client.connect(config.grpcAddr, {
      plaintext: true,
      timeout: config.connectTimeout,
    });
    connected = true;
  }
  return client;
}

export function invokeDetect({ text, modelId, tags = {}, metadata }) {
  return ensureConnected().invoke(
    "inference.v1.AIService/Detect",
    { text, model_id: modelId },
    {
      metadata: metadata === undefined ? metadataFor(config.apiKey) : metadata,
      tags,
      timeout: config.rpcTimeout,
    }
  );
}

function streamError(error) {
  return {
    code: error && error.code !== undefined ? error.code : grpc.StatusUnknown,
    details: error && Array.isArray(error.details) ? error.details : [],
    message: error && error.message ? String(error.message) : "Unknown stream error",
  };
}

// Server-streaming AnalyzeDocument. The promise resolves for both a clean end
// and a gRPC error so callers can assert on the outcome; there is no second,
// hand-rolled timeout on top of k6's own stream deadline.
export function invokeAnalyzeDocument({ text, modelId, tags = {}, metadata }) {
  const stream = new grpc.Stream(
    ensureConnected(),
    "inference.v1.AIService/AnalyzeDocument",
    {
      metadata: metadata === undefined ? metadataFor(config.apiKey) : metadata,
      tags,
      timeout: config.rpcTimeout,
    }
  );

  const result = {
    status: null,
    error: null,
    events: [],
    startedAt: Date.now(),
    endedAt: null,
    firstEventAt: null,
  };

  return new Promise((resolve) => {
    function finish(status, error) {
      if (result.endedAt !== null) {
        return;
      }
      result.status = status;
      result.error = error;
      result.endedAt = Date.now();
      resolve(result);
    }

    stream.on("data", (message) => {
      if (result.firstEventAt === null) {
        result.firstEventAt = Date.now();
      }
      result.events.push(message);
    });
    stream.on("error", (error) => {
      const normalized = streamError(error);
      finish(normalized.code, normalized);
    });
    stream.on("end", () => finish(grpc.StatusOK, null));

    try {
      stream.write({ text, model_id: modelId });
      stream.end();
    } catch (error) {
      finish(streamError(error).code, streamError(error));
    }
  });
}
