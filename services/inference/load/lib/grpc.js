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

export function closeClient() {
  if (!connected) {
    return;
  }

  client.close();
  connected = false;
}
